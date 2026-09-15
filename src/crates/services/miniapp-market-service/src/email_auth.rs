//! Passwordless identity. Codes are bound to one browser/device authorization,
//! persisted as keyed digests, and consumed atomically with account creation.
use crate::{
    auth::{random_token, safe_return_to, AuthService, CompletedOAuth, OAuthFlowRecord},
    db::token_hash,
    error::{MarketError, MarketResult},
};
use chrono::Utc;
use hmac::{Hmac, Mac};
use lettre::{
    message::{
        header::{ContentTransferEncoding, ContentType},
        Attachment, Mailbox, MultiPart, SinglePart,
    },
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use rand::{rngs::OsRng, Rng};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sqlx::Row;

#[derive(Clone)]
pub(crate) struct Mailer {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}
impl std::fmt::Debug for Mailer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Mailer(<redacted>)")
    }
}
impl Mailer {
    pub(crate) fn from_env() -> MarketResult<Option<Self>> {
        let get = |key| std::env::var(key).ok().filter(|s| !s.is_empty());
        let Some(password) = get("SMTP_PASSWORD") else {
            return Ok(None);
        };
        let username = get("SMTP_USERNAME")
            .ok_or_else(|| MarketError::internal("SMTP_USERNAME is required"))?;
        let host = get("SMTP_HOST").unwrap_or_else(|| "smtp.qiye.aliyun.com".into());
        let security = get("SMTP_SECURITY").unwrap_or_else(|| "ssl".into());
        let builder = match security.as_str() {
            "ssl" => AsyncSmtpTransport::<Tokio1Executor>::relay(&host),
            "starttls" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host),
            _ => {
                return Err(MarketError::internal(
                    "SMTP_SECURITY must be ssl or starttls",
                ))
            }
        }
        .map_err(|_| MarketError::internal("Invalid SMTP TLS configuration"))?;
        let port = get("SMTP_PORT")
            .unwrap_or_else(|| if security == "ssl" { "465" } else { "587" }.into())
            .parse::<u16>()
            .map_err(|_| MarketError::internal("Invalid SMTP_PORT"))?;
        let from = Mailbox::new(
            Some(get("SMTP_FROM_NAME").unwrap_or_else(|| "OpenBitFun".into())),
            username
                .parse()
                .map_err(|_| MarketError::internal("Invalid SMTP_USERNAME"))?,
        );
        Ok(Some(Self {
            transport: builder
                .port(port)
                .timeout(Some(std::time::Duration::from_secs(15)))
                .credentials(Credentials::new(username, password))
                .build(),
            from,
        }))
    }
    async fn send(&self, email: &str, code: &str) -> MarketResult<()> {
        let message = verification_message(self.from.clone(), email, code)?;
        tokio::time::timeout(
            std::time::Duration::from_secs(20),
            self.transport.send(message),
        )
        .await
        .map_err(|_| delivery_error())?
        .map_err(|_| delivery_error())?;
        Ok(())
    }
}
fn verification_message(from: Mailbox, email: &str, code: &str) -> MarketResult<Message> {
    Message::builder()
        .from(from)
        .to(email.parse().map_err(|_| invalid_email())?)
        .subject("OpenBitFun 登录验证码 / Sign-in code")
        .multipart(MultiPart::alternative()
            .singlepart(SinglePart::plain(format!("你的 OpenBitFun 登录验证码是：{code}\n\n验证码 10 分钟内有效，仅可使用一次。请勿向他人透露。\n如非本人操作，请忽略此邮件。\n\nYour OpenBitFun verification code is: {code}\nIt expires in 10 minutes and can only be used once. Do not share this code.\nIf you did not request it, ignore this email.\n\nOpenBitFun")))
            .multipart(MultiPart::related()
                .singlepart(SinglePart::builder().header(ContentType::TEXT_HTML).header(ContentTransferEncoding::Base64).body(include_str!("email/sign-in.html").replace("{{code}}", code)))
                .singlepart(Attachment::new_inline("openbitfun-app-icon".into()).body(
                    include_bytes!("email/app-icon.png").to_vec(),
                    ContentType::parse("image/png").expect("valid PNG MIME type"),
                ))))
        .map_err(|_| MarketError::internal("Could not compose verification email"))
}

fn delivery_error() -> MarketError {
    MarketError::service_unavailable(
        "email_delivery_failed",
        "Could not send the verification email. Please try again later.",
    )
}
fn invalid_email() -> MarketError {
    MarketError::bad_request("invalid_email", "Enter a valid email address.")
}
fn invalid_code() -> MarketError {
    MarketError::bad_request(
        "invalid_email_code",
        "The verification code is incorrect, expired, or already used.",
    )
}
fn rate_limit() -> MarketError {
    MarketError::new(
        axum::http::StatusCode::TOO_MANY_REQUESTS,
        "email_rate_limit",
        "Too many verification requests. Please try again later.",
    )
}
fn normalize_email(value: &str) -> MarketResult<String> {
    let email = value.trim().to_ascii_lowercase();
    if email.len() > 254
        || !email.is_ascii()
        || email
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
        || !email.contains('@')
        || email.parse::<lettre::Address>().is_err()
    {
        return Err(invalid_email());
    }
    Ok(email)
}
fn code_digest(secret: &str, id: &str, code: &str) -> String {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts arbitrary keys");
    mac.update(id.as_bytes());
    mac.update(b":");
    mac.update(code.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoginRequest {
    pub ticket: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmailSendRequest {
    pub ticket: String,
    pub email: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmailVerifyRequest {
    pub ticket: String,
    pub challenge_id: String,
    pub code: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmailSent {
    pub challenge_id: String,
    pub retry_after_seconds: u32,
}

impl AuthService {
    pub(crate) async fn create_login_flow(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        transaction_id: Option<&str>,
        return_to: &str,
    ) -> MarketResult<String> {
        let ticket = random_token(32);
        let now = Utc::now().timestamp();
        let inserted = sqlx::query("INSERT INTO login_flows(ticket_hash, transaction_id, return_to, expires_at) SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM login_flows WHERE expires_at > ?) < 8192")
            .bind(token_hash(&ticket)).bind(transaction_id).bind(safe_return_to(return_to)).bind(now + 600).bind(now).execute(&mut **tx).await.map_err(MarketError::internal)?;
        if inserted.rows_affected() != 1 {
            return Err(rate_limit());
        }
        Ok(ticket)
    }
    pub(crate) async fn start_web_login(&self, return_to: &str) -> MarketResult<String> {
        let mut tx = self
            .db
            .pool()
            .begin()
            .await
            .map_err(MarketError::internal)?;
        let ticket = self.create_login_flow(&mut tx, None, return_to).await?;
        tx.commit().await.map_err(MarketError::internal)?;
        Ok(ticket)
    }
    async fn login_flow(&self, ticket: &str) -> MarketResult<OAuthFlowRecord> {
        let row = sqlx::query("SELECT transaction_id, return_to FROM login_flows WHERE ticket_hash = ? AND expires_at > ? AND consumed_at IS NULL")
            .bind(token_hash(ticket)).bind(Utc::now().timestamp()).fetch_optional(self.db.pool()).await.map_err(MarketError::internal)?.ok_or_else(invalid_code)?;
        let transaction_id: Option<String> = row.get("transaction_id");
        Ok(OAuthFlowRecord {
            flow_kind: if transaction_id.is_some() {
                "desktop"
            } else {
                "web"
            }
            .into(),
            transaction_id,
            return_to: row.get("return_to"),
            code_verifier: String::new(),
        })
    }
    pub(crate) async fn login_github(&self, ticket: &str) -> MarketResult<String> {
        let flow = self.login_flow(ticket).await?;
        self.create_oauth_flow(
            &flow.flow_kind,
            flow.transaction_id.as_deref(),
            &flow.return_to,
        )
        .await
    }
    pub(crate) async fn send_email_code(
        &self,
        request: EmailSendRequest,
    ) -> MarketResult<EmailSent> {
        let mailer = self.mailer.as_ref().ok_or_else(|| {
            MarketError::service_unavailable(
                "email_not_configured",
                "Email sign-in is unavailable on this server.",
            )
        })?;
        let (sent, code) = self.prepare_email_code(request).await?;
        // Failure consumes the code; quota remains charged even on delivery failure.
        if let Err(error) = mailer.send(&sent.1, &code).await {
            sqlx::query("UPDATE email_challenges SET consumed_at = ? WHERE id = ?")
                .bind(Utc::now().timestamp())
                .bind(&sent.0.challenge_id)
                .execute(self.db.pool())
                .await
                .map_err(MarketError::internal)?;
            return Err(error);
        }
        Ok(sent.0)
    }
    async fn prepare_email_code(
        &self,
        request: EmailSendRequest,
    ) -> MarketResult<((EmailSent, String), String)> {
        let email = normalize_email(&request.email)?;
        self.login_flow(&request.ticket).await?;
        let now = Utc::now().timestamp();
        let id = random_token(24);
        let code = format!("{:06}", OsRng.gen_range(0..1_000_000u32));
        let mut tx = self
            .db
            .pool()
            .begin()
            .await
            .map_err(MarketError::internal)?;
        // INSERT is the first statement: serialize competing requests before quota evaluation.
        let inserted = sqlx::query("INSERT INTO email_challenges(id, ticket_hash, email, code_hash, created_at, expires_at) SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM email_challenges WHERE email = ? AND created_at > ?) AND (SELECT COUNT(*) FROM email_challenges WHERE email = ? AND created_at > ?) < 10 AND (SELECT COUNT(*) FROM email_challenges WHERE created_at > ?) < 30 AND (SELECT COUNT(*) FROM email_challenges WHERE created_at > ?) < 1000")
            .bind(&id).bind(token_hash(&request.ticket)).bind(&email).bind(code_digest(&self.config.session_secret, &id, &code)).bind(now).bind(now + 600)
            .bind(&email).bind(now - 60).bind(&email).bind(now - 86400).bind(now - 60).bind(now - 86400).execute(&mut *tx).await.map_err(MarketError::internal)?;
        if inserted.rows_affected() != 1 {
            return Err(rate_limit());
        }
        sqlx::query("UPDATE email_challenges SET consumed_at = ? WHERE ticket_hash = ? AND id != ? AND consumed_at IS NULL").bind(now).bind(token_hash(&request.ticket)).bind(&id).execute(&mut *tx).await.map_err(MarketError::internal)?;
        tx.commit().await.map_err(MarketError::internal)?;
        Ok((
            (
                EmailSent {
                    challenge_id: id,
                    retry_after_seconds: 60,
                },
                email,
            ),
            code,
        ))
    }
    pub(crate) async fn verify_email_code(
        &self,
        request: EmailVerifyRequest,
    ) -> MarketResult<CompletedOAuth> {
        if request.code.len() != 6 || !request.code.bytes().all(|b| b.is_ascii_digit()) {
            return Err(invalid_code());
        }
        let flow = self.login_flow(&request.ticket).await?;
        let now = Utc::now().timestamp();
        let mut tx = self
            .db
            .pool()
            .begin()
            .await
            .map_err(MarketError::internal)?;
        let row = sqlx::query("UPDATE email_challenges SET attempts = attempts + 1 WHERE id = ? AND ticket_hash = ? AND expires_at > ? AND consumed_at IS NULL AND attempts < 5 RETURNING email, code_hash")
            .bind(&request.challenge_id).bind(token_hash(&request.ticket)).bind(now).fetch_optional(&mut *tx).await.map_err(MarketError::internal)?;
        let Some(row) = row else {
            return Err(invalid_code());
        };
        let expected: String = row.get("code_hash");
        let digest = code_digest(
            &self.config.session_secret,
            &request.challenge_id,
            &request.code,
        );
        if expected.len() != digest.len()
            || expected
                .as_bytes()
                .iter()
                .zip(digest.as_bytes())
                .fold(0u8, |acc, (a, b)| acc | (a ^ b))
                != 0
        {
            tx.commit().await.map_err(MarketError::internal)?;
            return Err(invalid_code());
        }
        let consumed = sqlx::query("UPDATE login_flows SET consumed_at = ? WHERE ticket_hash = ? AND consumed_at IS NULL AND expires_at > ?").bind(now).bind(token_hash(&request.ticket)).bind(now).execute(&mut *tx).await.map_err(MarketError::internal)?;
        if consumed.rows_affected() != 1 {
            return Err(invalid_code());
        }
        sqlx::query("UPDATE email_challenges SET consumed_at = ? WHERE id = ?")
            .bind(now)
            .bind(&request.challenge_id)
            .execute(&mut *tx)
            .await
            .map_err(MarketError::internal)?;
        let email: String = row.get("email");
        let existing: Option<(i64,)> =
            sqlx::query_as("SELECT user_id FROM email_identities WHERE email = ?")
                .bind(&email)
                .fetch_optional(&mut *tx)
                .await
                .map_err(MarketError::internal)?;
        let user_id = if let Some((id,)) = existing {
            id
        } else {
            // Never auto-link to GitHub by an unverified/public profile email.
            let user = sqlx::query("INSERT INTO users(github_id, login, avatar_url, created_at, updated_at) VALUES(NULL, ?, '', ?, ?)").bind(format!("user-{}", uuid::Uuid::new_v4().simple())).bind(now).bind(now).execute(&mut *tx).await.map_err(MarketError::internal)?;
            let id = user.last_insert_rowid();
            sqlx::query(
                "INSERT INTO email_identities(email, user_id, verified_at) VALUES(?, ?, ?)",
            )
            .bind(&email)
            .bind(id)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(MarketError::internal)?;
            id
        };
        tx.commit().await.map_err(MarketError::internal)?;
        self.finish_verified_oauth(flow, user_id).await
    }
}

impl AuthService {
    pub(crate) async fn email_browser_redirect(
        &self,
        completed: CompletedOAuth,
    ) -> MarketResult<String> {
        let (session_token, return_to) = match completed {
            CompletedOAuth::Web {
                session_token,
                return_to,
                ..
            } => (session_token, return_to),
            CompletedOAuth::Desktop { session_token, .. } => {
                (session_token, "https://auth.openbitfun.com/complete".into())
            }
        };
        let grant = random_token(32);
        let now = Utc::now().timestamp();
        let mut tx = self
            .db
            .pool()
            .begin()
            .await
            .map_err(MarketError::internal)?;
        let inserted = sqlx::query("INSERT INTO email_browser_grants(grant_hash, user_id, return_to, expires_at) SELECT ?, user_id, ?, ? FROM web_sessions WHERE token_hash = ? AND expires_at > ?")
            .bind(token_hash(&grant)).bind(return_to).bind(now + 60).bind(token_hash(&session_token)).bind(now).execute(&mut *tx).await.map_err(MarketError::internal)?;
        if inserted.rows_affected() != 1 {
            return Err(invalid_code());
        }
        sqlx::query("DELETE FROM web_sessions WHERE token_hash = ?")
            .bind(token_hash(&session_token))
            .execute(&mut *tx)
            .await
            .map_err(MarketError::internal)?;
        tx.commit().await.map_err(MarketError::internal)?;
        Ok(format!(
            "{}/api/v1/auth/email/complete?grant={grant}",
            self.config.public_base_url
        ))
    }
    pub(crate) async fn complete_email_browser(&self, grant: &str) -> MarketResult<CompletedOAuth> {
        let row = sqlx::query("DELETE FROM email_browser_grants WHERE grant_hash = ? AND expires_at > ? RETURNING user_id, return_to")
            .bind(token_hash(grant)).bind(Utc::now().timestamp()).fetch_optional(self.db.pool()).await.map_err(MarketError::internal)?.ok_or_else(invalid_code)?;
        self.finish_verified_oauth(
            OAuthFlowRecord {
                flow_kind: "web".into(),
                transaction_id: None,
                code_verifier: String::new(),
                return_to: row.get("return_to"),
            },
            row.get("user_id"),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{auth::DesktopAuthPollRequest, config::MarketConfig, db::Database};
    async fn setup() -> (tempfile::TempDir, AuthService) {
        let dir = tempfile::tempdir().unwrap();
        let config = MarketConfig {
            bind: "127.0.0.1:0".parse().unwrap(),
            public_base_url: "https://market.openbitfun.com/miniapp".into(),
            database_path: dir.path().join("db"),
            artifact_dir: dir.path().join("artifacts"),
            web_dir: dir.path().into(),
            github_callback_url: None,
            github_client_id: Some("id".into()),
            github_client_secret: Some("secret".into()),
            session_secret: "test-only-session-secret-at-least-24".into(),
            admin_github_ids: [42, 0].into_iter().collect(),
            public_browse: true,
            web_submissions_enabled: false,
        };
        let db = Database::open(&config.database_path).await.unwrap();
        (dir, AuthService::new(config, db).unwrap())
    }
    async fn code(service: &AuthService, ticket: &str, email: &str) -> (String, String) {
        let ((sent, _), code) = service
            .prepare_email_code(EmailSendRequest {
                ticket: ticket.into(),
                email: email.into(),
            })
            .await
            .unwrap();
        (sent.challenge_id, code)
    }
    fn verify(ticket: &str, id: &str, code: &str) -> EmailVerifyRequest {
        EmailVerifyRequest {
            ticket: ticket.into(),
            challenge_id: id.into(),
            code: code.into(),
        }
    }
    #[tokio::test]
    async fn email_is_independent_one_use_and_preserves_device_token_protocol() {
        let (_dir, service) = setup().await;
        let github = service
            .db
            .upsert_github_user(42, "alice", "")
            .await
            .unwrap();
        let start = service.start_desktop_login(true).await.unwrap();
        let ticket = start.authorization_url.split("#ticket=").nth(1).unwrap();
        let (id, code) = code(&service, ticket, "Alice@Example.com").await;
        let stored: (String,) =
            sqlx::query_as("SELECT code_hash FROM email_challenges WHERE id = ?")
                .bind(&id)
                .fetch_one(service.db.pool())
                .await
                .unwrap();
        assert_ne!(stored.0, code);
        assert_eq!(stored.0.len(), 64);
        let completed = service
            .verify_email_code(verify(ticket, &id, &code))
            .await
            .unwrap();
        assert!(service
            .verify_email_code(verify(ticket, &id, &code))
            .await
            .is_err());
        let redirect = service.email_browser_redirect(completed).await.unwrap();
        let grant = url::Url::parse(&redirect)
            .unwrap()
            .query_pairs()
            .find(|(k, _)| k == "grant")
            .unwrap()
            .1
            .into_owned();
        let browser = service.complete_email_browser(&grant).await.unwrap();
        assert!(service.complete_email_browser(&grant).await.is_err());
        let CompletedOAuth::Web { session_token, .. } = browser else {
            panic!("Expected browser session")
        };
        let (user, _, _) = service
            .db
            .web_session_user(&session_token)
            .await
            .unwrap()
            .unwrap();
        assert_ne!(github.internal_id, user.internal_id);
        assert_eq!(user.profile.github_id, 0);
        assert!(user.profile.identity_id().unwrap().starts_with("email-"));
        assert!(!service.is_admin(&user));
        let poll = service
            .poll_desktop(DesktopAuthPollRequest {
                transaction_id: start.transaction_id.clone(),
                transaction_secret: start.transaction_secret.clone(),
            })
            .await
            .unwrap();
        assert_eq!(poll.status, "authorized");
        let tokens = poll.tokens.unwrap();
        let (token_user, _) = service
            .db
            .api_token_user(&tokens.access_token, "access")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(token_user.internal_id, user.internal_id);
        assert!(service
            .poll_desktop(DesktopAuthPollRequest {
                transaction_id: start.transaction_id,
                transaction_secret: start.transaction_secret
            })
            .await
            .unwrap()
            .tokens
            .is_none());
    }
    #[tokio::test]
    async fn wrong_codes_exhaust_budget_and_cannot_cross_flows() {
        let (_dir, service) = setup().await;
        let a = service.start_web_login("/miniapp/").await.unwrap();
        let b = service.start_web_login("/skin/").await.unwrap();
        let (id, code) = code(&service, &a, "alice@example.com").await;
        assert!(service
            .verify_email_code(verify(&b, &id, &code))
            .await
            .is_err());
        let wrong = if code == "000000" { "111111" } else { "000000" };
        for _ in 0..5 {
            assert!(service
                .verify_email_code(verify(&a, &id, wrong))
                .await
                .is_err());
        }
        assert!(service
            .verify_email_code(verify(&a, &id, &code))
            .await
            .is_err());
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
            .fetch_one(service.db.pool())
            .await
            .unwrap();
        assert_eq!(count.0, 0);
    }
    #[tokio::test]
    async fn rate_limits_persist_and_expired_codes_fail() {
        let (dir, service) = setup().await;
        let a = service.start_web_login("/miniapp/").await.unwrap();
        let (id, code) = code(&service, &a, "alice@example.com").await;
        let reopened = AuthService::new(
            service.config.clone(),
            Database::open(&dir.path().join("db")).await.unwrap(),
        )
        .unwrap();
        assert_eq!(
            reopened
                .prepare_email_code(EmailSendRequest {
                    ticket: a.clone(),
                    email: "ALICE@example.com".into()
                })
                .await
                .unwrap_err()
                .code,
            "email_rate_limit"
        );
        sqlx::query("UPDATE email_challenges SET expires_at = 0 WHERE id = ?")
            .bind(&id)
            .execute(service.db.pool())
            .await
            .unwrap();
        assert!(service
            .verify_email_code(verify(&a, &id, &code))
            .await
            .is_err());
    }
    #[tokio::test]
    async fn concurrent_code_consumption_has_one_winner_and_relogin_reuses_email_account() {
        let (_dir, service) = setup().await;
        let ticket = service.start_web_login("/miniapp/").await.unwrap();
        let (id, code) = code(&service, &ticket, "alice@example.com").await;
        let (a, b) = tokio::join!(
            service.verify_email_code(verify(&ticket, &id, &code)),
            service.verify_email_code(verify(&ticket, &id, &code))
        );
        assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
        sqlx::query("UPDATE email_challenges SET created_at = created_at - 61")
            .execute(service.db.pool())
            .await
            .unwrap();
        let ticket = service.start_web_login("/miniapp/").await.unwrap();
        let (id, code) = self::code(&service, &ticket, "Alice@example.com").await;
        service
            .verify_email_code(verify(&ticket, &id, &code))
            .await
            .unwrap();
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
            .fetch_one(service.db.pool())
            .await
            .unwrap();
        assert_eq!(count.0, 1);
    }
    #[tokio::test]
    async fn http_routes_preserve_legacy_start_and_set_scoped_browser_cookies() {
        use axum::{
            body::{to_bytes, Body},
            http::{header, Request, StatusCode},
        };
        use std::sync::Arc;
        use tower::ServiceExt;
        let (_dir, mut auth) = setup().await;
        auth.mailer = None;
        let state = Arc::new(crate::routes::MarketState {
            config: auth.config.clone(),
            db: auth.db.clone(),
            artifacts: crate::artifacts::ArtifactStore::open(auth.config.artifact_dir.clone())
                .await
                .unwrap(),
            auth: auth.clone(),
        });
        let app = crate::routes::api_router(state);
        for (path, expected) in [
            (
                "/auth/desktop/start",
                "https://github.com/login/oauth/authorize?",
            ),
            (
                "/auth/desktop/start?methods=all",
                "https://auth.openbitfun.com/sign-in#ticket=",
            ),
        ] {
            let response = app
                .clone()
                .oneshot(Request::post(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let value: serde_json::Value =
                serde_json::from_slice(&to_bytes(response.into_body(), 16384).await.unwrap())
                    .unwrap();
            assert!(value["authorizationUrl"]
                .as_str()
                .unwrap()
                .starts_with(expected));
        }
        let response = app
            .clone()
            .oneshot(
                Request::post("/auth/email/send")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"ticket":"missing","email":"alice@example.com"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let ticket = auth.start_web_login("/skin/submissions").await.unwrap();
        let (id, code) = code(&auth, &ticket, "alice@example.com").await;
        let completed = auth
            .verify_email_code(verify(&ticket, &id, &code))
            .await
            .unwrap();
        let target =
            url::Url::parse(&auth.email_browser_redirect(completed).await.unwrap()).unwrap();
        let response = app
            .oneshot(
                Request::get(format!("/auth/email/complete?{}", target.query().unwrap()))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(response.status().is_redirection());
        assert_eq!(response.headers()[header::LOCATION], "/skin/submissions");
        let cookies: Vec<_> = response
            .headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .map(|v| v.to_str().unwrap())
            .collect();
        assert_eq!(cookies.len(), 4);
        assert!(cookies.iter().all(|v| !v.contains("Domain=")));
        assert!(cookies.iter().any(|v| v.contains("Path=/skin")));
        assert!(cookies.iter().any(|v| v.contains("Path=/miniapp")));
    }

    #[test]
    fn verification_email_has_html_and_plain_text_without_attachments() {
        let message = verification_message(
            "OpenBitFun <hello@example.com>".parse().unwrap(),
            "alice@example.com",
            "123456",
        )
        .unwrap();
        let raw = String::from_utf8(message.formatted()).unwrap();
        assert!(raw.contains("MIME-Version: 1.0\r\n"));
        assert!(raw.contains("Content-Type: text/plain; charset=utf-8\r\n"));
        assert!(!raw.contains("application/octet-stream"));
        assert!(!raw.contains("Content-Disposition: attachment"));
        use base64::Engine;
        assert!(raw.contains("Content-Transfer-Encoding: base64"));
        assert!(raw.contains("Content-Type: multipart/alternative;"));
        assert!(raw.contains("Content-Type: text/html; charset=utf-8"));
        assert!(raw.contains("Content-Type: multipart/related;"));
        assert!(raw.contains("Content-ID: <openbitfun-app-icon>"));
        assert!(raw.contains("Content-Disposition: inline"));
        let decode_part = |content_type: &str| {
            let part = raw
                .split("Content-Type: ")
                .find(|part| part.starts_with(content_type))
                .unwrap();
            let (_, body) = part.split_once("\r\n\r\n").unwrap();
            let encoded = body.split("\r\n--").next().unwrap();
            base64::engine::general_purpose::STANDARD
                .decode(encoded.split_whitespace().collect::<String>())
                .unwrap()
        };
        let plain = String::from_utf8(decode_part("text/plain;")).unwrap();
        assert!(plain.contains("Your OpenBitFun verification code is: 123456"));
        assert!(plain.contains("你的 OpenBitFun 登录验证码是：123456"));
        let html = String::from_utf8(decode_part("text/html;")).unwrap();
        assert!(html.contains("src=\"cid:openbitfun-app-icon\""));
        assert!(!html.contains("src=\"https://"));
        assert_eq!(
            decode_part("image/png"),
            include_bytes!("email/app-icon.png")
        );
        assert!(html.contains(">123456</div>"));
        assert!(!html.contains("{{code}}"));
        assert!(!html.contains("<script"));
    }

    #[test]
    fn address_validation_and_keyed_hash() {
        for address in [
            "a@example.com\r\nBcc: x@example.com",
            "",
            "a b@example.com",
            "Name <a@example.com>",
        ] {
            assert!(normalize_email(address).is_err());
        }
        assert_eq!(
            normalize_email(" Alice@Example.com ").unwrap(),
            "alice@example.com"
        );
        assert_ne!(
            code_digest("key", "a", "123456"),
            code_digest("other", "a", "123456")
        );
        assert_ne!(
            code_digest("key", "a", "123456"),
            code_digest("key", "b", "123456")
        );
    }
}
