package com.openbitfun.mobile.app.viewmodel

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import com.openbitfun.mobile.core.feature.session.ComposerImage

/** Retains prepared attachments across Activity recreation without putting image bytes in a Bundle. */
internal class ComposerAttachmentsViewModel : ViewModel() {
    private var sessionId: String? = null
    private var images = mutableStateOf<List<ComposerImage>>(emptyList())

    fun forSession(id: String): MutableState<List<ComposerImage>> {
        if (sessionId != id) {
            sessionId = id
            images = mutableStateOf(emptyList())
        }
        return images
    }
}
