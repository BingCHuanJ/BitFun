import { useEffect, useRef, useState, type FormEvent } from 'react';
import { marketApi } from './api';
import { useLocale } from './i18n';

export function AccountSignIn() {
  const { t, locale, setLocale } = useLocale();
  const [ticket, setTicket] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const initial = useRef<Promise<void> | null>(null);
  useEffect(() => {
    // Preserve a desktop ticket across reloads without putting its polling secret in the browser.
    if (!initial.current) initial.current = (async () => {
      const fragmentTicket = new URLSearchParams(window.location.hash.slice(1)).get('ticket');
      if (fragmentTicket) {
        const config = await marketApi.config();
        setTicket(fragmentTicket);
        setEmailEnabled(config.emailAuthConfigured === true);
        setGithubEnabled(config.githubAuthConfigured);
      } else {
        const start = await marketApi.startLogin(new URLSearchParams(window.location.search).get('returnTo') || '/miniapp/');
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#ticket=${encodeURIComponent(start.ticket)}`);
        setTicket(start.ticket); setEmailEnabled(start.emailEnabled); setGithubEnabled(start.githubEnabled);
      }
    })().catch(() => setError(t('emailStartFailed')));
  }, [t]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const showError = (cause: unknown) => {
    const key = cause && typeof cause === 'object' && 'code' in cause ? cause.code : '';
    setError(t(key === 'email_rate_limit' ? 'emailRateLimited' : key === 'invalid_email_code' ? 'emailCodeInvalid' : key === 'invalid_email' ? 'emailInvalid' : 'emailStartFailed'));
  };
  async function send(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setError('');
    try { const sent = await marketApi.sendEmailCode(ticket, email); setChallenge(sent.challengeId); setCode(''); setRetryAt(Date.now() + sent.retryAfterSeconds * 1000); }
    catch (cause) { showError(cause); } finally { setBusy(false); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await marketApi.verifyEmailCode(ticket, challenge, code);
      const target = new URL(result.redirectUrl, window.location.origin);
      if (![window.location.origin, 'https://auth.openbitfun.com', 'https://market.openbitfun.com'].includes(target.origin)) throw new Error('Untrusted return URL');
      window.location.assign(target.href);
    } catch (cause) { showError(cause); setBusy(false); }
  }
  async function github() {
    setBusy(true); setError('');
    try { const result = await marketApi.loginGithub(ticket); const url = new URL(result.authorizationUrl);
      if (url.origin !== 'https://github.com' || url.pathname !== '/login/oauth/authorize' || url.username || url.password) throw new Error('Untrusted authorization URL');
      window.location.assign(url.href);
    } catch (cause) { showError(cause); setBusy(false); }
  }
  return <main className="form-page"><section className="auth-gate account-sign-in">
    <h1>{t('accountSignIn')}</h1><p>{t('emailLoginIntro')}</p>
    <select aria-label={t('language')} value={locale} onChange={event => setLocale(event.target.value as typeof locale)}>
      <option value="en-US">English</option><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option>
    </select>
    {emailEnabled && <form onSubmit={challenge ? verify : send}>
      <label>{t('emailAddress')}<input type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy || !!challenge} onChange={event => setEmail(event.target.value)} /></label>
      {challenge && <><p role="status">{t('emailCodeSent')}</p><label>{t('emailCode')}<input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} /></label></>}
      <button className="button primary" type="submit" disabled={busy || !ticket}>{t(challenge ? 'emailVerify' : 'emailSendCode')}</button>
      {challenge && <><button className="button" type="button" disabled={busy || now < retryAt} onClick={() => void send()}>{t(now < retryAt ? 'emailResendWait' : 'emailResend')}</button><button className="button" type="button" disabled={busy} onClick={() => { setChallenge(''); setCode(''); setError(''); }}>{t('emailChange')}</button></>}
    </form>}
    {githubEnabled && <button className="button" disabled={busy || !ticket} onClick={() => void github()}>{t('githubSignIn')}</button>}
    {!!ticket && !emailEnabled && !githubEnabled && <p>{t('emailUnavailable')}</p>}
    {error && <p role="alert">{error}</p>}
  </section></main>;
}
