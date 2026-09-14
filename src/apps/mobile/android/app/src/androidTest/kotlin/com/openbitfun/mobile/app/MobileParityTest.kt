package com.openbitfun.mobile.app

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import com.openbitfun.mobile.app.ui.chat.*
import com.openbitfun.mobile.app.ui.chat.tool.*
import com.openbitfun.mobile.app.ui.miniapps.BuiltinMiniAppBridge
import com.openbitfun.mobile.app.ui.theme.OpenBitFunTheme
import com.openbitfun.mobile.core.feature.connection.ConnectionPhase
import com.openbitfun.mobile.core.feature.session.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class MobileParityTest {
    @get:Rule val rule = createComposeRule()

    @Test fun runningRemoteDraftSendsInsteadOfStopping() {
        var sent = 0
        var stopped = 0
        rule.setContent {
            OpenBitFunTheme(dark = true) {
                ComposerBar(draft = "Add tests", images = emptyList(), busy = false, streaming = true,
                    phase = ConnectionPhase.CONNECTED, model = null, capabilities = ChatComposerCapabilities.RemoteChat,
                    placeholder = "Message", onDraftChange = {}, onRemoveImage = {}, onAttach = {}, onVoice = {},
                    onSend = { sent++ }, onStop = { stopped++ }, onOpenModels = {}, onSelectModel = {}, modifier = Modifier)
            }
        }
        rule.onNodeWithTag(COMPOSER_SEND_TEST_TAG).performClick()
        assertEquals(1, sent)
        assertEquals(0, stopped)
    }

    @Test fun unsupportedPlanIsVisibleButCannotExecute() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        rule.setContent {
            OpenBitFunTheme(dark = false) {
                ToolStatusRow(plan(), true, {}, {}, {}, {}, {}, { _, _ -> }, Modifier)
            }
        }
        rule.onNodeWithText(context.getString(R.string.plan_build)).assertIsNotEnabled()
        rule.onNodeWithText(context.getString(R.string.plan_unsupported)).assertExists()
    }

    @Test fun supportedPlanOpensItsRemoteFileAndDispatchesBuild() {
        var opened = ""
        var built = ""
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        rule.setContent {
            OpenBitFunTheme(dark = false) {
                CompositionLocalProvider(LocalPlanActions provides PlanActions(true, true, { built = it.path })) {
                    ToolStatusRow(plan(), true, {}, {}, {}, {}, {}, { path, _ -> opened = path }, Modifier)
                }
            }
        }
        rule.onNodeWithText(context.getString(R.string.plan_view)).performClick()
        rule.onNodeWithText(context.getString(R.string.plan_build)).performClick()
        assertEquals("/repo/review.plan.md", opened)
        assertEquals(opened, built)
    }

    @Test fun miniAppStorageSurvivesHostRecreationAndRetainsCorruption() {
        // Isolate the test namespace while retaining the target process's writable storage context.
        val context = object : android.content.ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("parity-test-$name", mode)
        }
        val preferences = context.getSharedPreferences("miniapps-builtin-gomoku", 0)
        preferences.edit().clear().commit()
        var reply = JSONObject()
        fun bridge() = BuiltinMiniAppBridge(context, "builtin-gomoku") { reply = JSONObject(it) }
        bridge().request("""{"id":"set","method":"storage.set","params":{"key":"stats","value":{"wins":3}}}""")
        assertFalse(reply.toString(), reply.has("error"))
        bridge().request("""{"id":"get","method":"storage.get","params":{"key":"stats"}}""")
        assertEquals(3, reply.getJSONObject("result").getInt("wins"))
        bridge().request("""{"id":"bad-key","method":"storage.get","params":{"key":"regex-state"}}""")
        assertTrue(reply.has("error"))
        preferences.edit().putString("stats", "unparseable").commit()
        bridge().request("""{"id":"get","method":"storage.get","params":{"key":"stats"}}""")
        assertTrue(reply.has("error"))
        assertEquals("unparseable", preferences.getString("stats", null))
        preferences.edit().clear().commit()
    }

    @Test fun preparedAttachmentsSurviveRecreatedOwnersAndStaySessionScoped() {
        val store = androidx.lifecycle.ViewModelStore()
        fun owner() = object : androidx.lifecycle.ViewModelStoreOwner { override val viewModelStore = store }
        val first = androidx.lifecycle.ViewModelProvider(owner())[com.openbitfun.mobile.app.viewmodel.ComposerAttachmentsViewModel::class.java]
        val image = ComposerImage("one", "data:image/png;base64,AAAA", "image/png")
        first.forSession("session-a").value = listOf(image)
        val recreated = androidx.lifecycle.ViewModelProvider(owner())[com.openbitfun.mobile.app.viewmodel.ComposerAttachmentsViewModel::class.java]
        assertEquals(listOf(image), recreated.forSession("session-a").value)
        assertTrue(recreated.forSession("session-b").value.isEmpty())
        store.clear()
    }

    @Test fun gomokuAllocatesVisibleViewport() = captureOfflineMiniApp(0)
    @Test fun regexAllocatesVisibleViewport() = captureOfflineMiniApp(1)
    @Test fun divinationAllocatesVisibleViewport() = captureOfflineMiniApp(2)

    private fun captureOfflineMiniApp(index: Int) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val locale = if (context.resources.configuration.locales[0].language == "zh") "zh-CN" else "en-US"
        val catalog = org.json.JSONArray(context.assets.open("miniapps/catalog.json").bufferedReader().use { it.readText() })
        rule.setContent { OpenBitFunTheme(dark = false) { com.openbitfun.mobile.app.ui.miniapps.MiniAppsButton() } }
        rule.onNodeWithText(context.getString(R.string.miniapps_title)).performClick()
        run {
            val app = catalog.getJSONObject(index)
            val title = app.getJSONObject("locales").getJSONObject(locale).getString("name")
            rule.onNodeWithText(title).performClick()
            lateinit var web: android.webkit.WebView
            androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom(android.webkit.WebView::class.java))
                .check { view, error ->
                    if (error != null) throw error
                    web = view as android.webkit.WebView
                    assertTrue(web.width > 0 && web.height > 0)
                }
            val ready = java.util.concurrent.atomic.AtomicBoolean(false)
            rule.waitUntil(15_000) {
                instrumentation.runOnMainSync {
                    web.evaluateJavascript("document.querySelector('iframe').dataset.loaded === 'true' && document.querySelector('iframe').clientHeight > 0") {
                        ready.set(it == "true")
                    }
                }
                ready.get()
            }
            rule.onNodeWithText(context.getString(R.string.miniapps_back)).performClick()
        }
    }

    private fun plan() = ToolCard("plan", "Write", ToolPhase.COMPLETED, ToolKind.DOCUMENT, ToolOperation.UNKNOWN,
        "review.plan.md", "/repo/review.plan.md", "review.plan.md", "", "", null, emptySet())
}
