package dev.agenthive.phone

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.audio.JavaAudioDeviceModule
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.VideoTrack

/**
 * Discord-style voice: mesh of RTCPeerConnections, signaling relayed through
 * the hive's /ws ("voice_signal" events) — a direct port of the web client's
 * voice.js. iceServers: [] — same-LAN/mesh only, exactly like the web app.
 */
class VoiceEngine(
    private val ctx: Context,
    private val send: (JSONObject) -> Unit,
    private val onRoster: () -> Unit,
) {
    private var factory: PeerConnectionFactory? = null
    private var localAudio: AudioTrack? = null
    private var audioSource: AudioSource? = null
    private val peers = HashMap<Int, PeerConnection>()
    private val offerSent = HashSet<Int>()
    private var eglBase: EglBase? = null

    private val audioMgr = ctx.getSystemService(Context.AUDIO_SERVICE)
        as android.media.AudioManager

    var channelId: Int = 0
        private set
    var meId: Int = 0
    var joined = false
        private set

    /** Discord defaults to speakerphone in voice channels. */
    fun setSpeaker(on: Boolean) {
        runCatching {
            audioMgr.mode = android.media.AudioManager.MODE_IN_COMMUNICATION
            audioMgr.isSpeakerphoneOn = on
        }
    }

    private fun ensureFactory() {
        if (factory != null) return
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions
                .builder(ctx)
                .setEnableInternalTracer(false)
                .createInitializationOptions())
        eglBase = EglBase.create()
        val adm = JavaAudioDeviceModule.builder(ctx)
            .setUseHardwareAcousticEchoCanceler(true)
            .setUseHardwareNoiseSuppressor(true)
            .createAudioDeviceModule()
        factory = PeerConnectionFactory.builder()
            .setAudioDeviceModule(adm)
            .setVideoEncoderFactory(
                DefaultVideoEncoderFactory(eglBase!!.eglBaseContext, true, true))
            .setVideoDecoderFactory(
                DefaultVideoDecoderFactory(eglBase!!.eglBaseContext))
            .createPeerConnectionFactory()
        audioSource = factory!!.createAudioSource(MediaConstraints())
        localAudio = factory!!.createAudioTrack("ARDAMSa0", audioSource)
    }

    fun join(cid: Int, myUid: Int) {
        ensureFactory()
        channelId = cid
        meId = myUid
        joined = true
        localAudio?.setEnabled(true)
        setSpeaker(true)
        send(JSONObject().put("type", "voice_join").put("channel_id", cid))
    }

    fun leave() {
        if (joined)
            send(JSONObject().put("type", "voice_leave").put("channel_id", channelId))
        teardown()
    }

    private fun teardown() {
        joined = false
        channelId = 0
        for (pc in peers.values) runCatching { pc.dispose() }
        peers.clear()
        offerSent.clear()
        // setSpeaker() put the device in MODE_IN_COMMUNICATION — restore,
        // otherwise post-call audio stays on earpiece routing until some
        // other app resets it
        runCatching {
            audioMgr.isSpeakerphoneOn = false
            audioMgr.mode = android.media.AudioManager.MODE_NORMAL
        }
        onRoster()
    }

    fun setMuted(muted: Boolean) {
        localAudio?.setEnabled(!muted)
        send(JSONObject().put("type", "voice_mute")
            .put("channel_id", channelId).put("muted", muted))
    }

    fun setDeafened(deaf: Boolean) {
        // deafen = mute + silence remote audio
        localAudio?.setEnabled(!deaf)
        send(JSONObject().put("type", "voice_deafen")
            .put("channel_id", channelId).put("deafened", deaf))
        if (deaf)
            send(JSONObject().put("type", "voice_mute")
                .put("channel_id", channelId).put("muted", true))
    }

    /** "voice" roster broadcast → sync the peer mesh (lower uid offers). */
    fun onRoster(members: JSONArray) {
        if (!joined) return
        val want = HashSet<Int>()
        for (i in 0 until members.length()) {
            val m = members.optJSONObject(i) ?: continue
            val uid = m.optInt("id")
            if (uid != meId && uid > 0) want += uid
        }
        for (uid in peers.keys.toList())
            if (uid !in want) dropPeer(uid)
        for (uid in want) {
            val pc = ensurePeer(uid)
            if (meId < uid && uid !in offerSent &&
                pc.signalingState() == PeerConnection.SignalingState.STABLE) {
                offerSent += uid
                val cons = MediaConstraints().apply {
                    mandatory += MediaConstraints.KeyValuePair(
                        "OfferToReceiveAudio", "true")
                }
                pc.createOffer(object : SdpAdapter() {
                    override fun onCreateSuccess(sdp: SessionDescription) {
                        pc.setLocalDescription(SdpAdapter(), sdp)
                        send(JSONObject().put("type", "voice_signal")
                            .put("channel_id", channelId).put("to", uid)
                            .put("data", JSONObject().put("sdp",
                                JSONObject()
                                    .put("type", sdp.type.canonicalForm())
                                    .put("sdp", sdp.description))))
                    }
                }, cons)
            }
        }
        onRoster()
    }

    /** "voice_signal" — remote sdp/candidate for one peer. */
    fun onSignal(from: Int, data: JSONObject) {
        if (!joined) return
        val pc = ensurePeer(from)
        val sdp = data.optJSONObject("sdp")
        val cand = data.optJSONObject("candidate")
        try {
            if (sdp != null) {
                val type = when (sdp.optString("type")) {
                    "offer" -> SessionDescription.Type.OFFER
                    "answer" -> SessionDescription.Type.ANSWER
                    "pranswer" -> SessionDescription.Type.PRANSWER
                    else -> SessionDescription.Type.OFFER
                }
                val desc = SessionDescription(type, sdp.optString("sdp"))
                pc.setRemoteDescription(SdpAdapter(), desc)
                if (type == SessionDescription.Type.OFFER) {
                    val cons = MediaConstraints().apply {
                        mandatory += MediaConstraints.KeyValuePair(
                            "OfferToReceiveAudio", "true")
                    }
                    pc.createAnswer(object : SdpAdapter() {
                        override fun onCreateSuccess(ans: SessionDescription) {
                            pc.setLocalDescription(SdpAdapter(), ans)
                            send(JSONObject().put("type", "voice_signal")
                                .put("channel_id", channelId).put("to", from)
                                .put("data", JSONObject().put("sdp",
                                    JSONObject()
                                        .put("type", ans.type.canonicalForm())
                                        .put("sdp", ans.description))))
                        }
                    }, cons)
                }
            } else if (cand != null) {
                pc.addIceCandidate(IceCandidate(
                    cand.optString("sdpMid"),
                    cand.optInt("sdpMLineIndex"),
                    cand.optString("candidate")))
            }
        } catch (e: Exception) {
            Log.w("VoiceEngine", "signal error: ${e.message}")
        }
    }

    private fun ensurePeer(uid: Int): PeerConnection {
        peers[uid]?.let { return it }
        val cfg = PeerConnection.RTCConfiguration(emptyList()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy =
                PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        val pc = factory!!.createPeerConnection(cfg, object : PeerObserver() {
            override fun onIceCandidate(c: IceCandidate) {
                send(JSONObject().put("type", "voice_signal")
                    .put("channel_id", channelId).put("to", uid)
                    .put("data", JSONObject().put("candidate",
                        JSONObject()
                            .put("candidate", c.sdp)
                            .put("sdpMid", c.sdpMid)
                            .put("sdpMLineIndex", c.sdpMLineIndex))))
            }
            override fun onAddTrack(r: RtpReceiver, streams: Array<MediaStream>) {
                val t = r.track()
                if (t is AudioTrack) t.setEnabled(true)
            }
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                if (newState == PeerConnection.PeerConnectionState.FAILED)
                    runCatching { peers[uid]?.restartIce() }
            }
        }) ?: return PeerConnection.RTCConfiguration(emptyList())
            .let { throw IllegalStateException("pc create failed") }
        localAudio?.let { pc.addTrack(it, listOf("stream0")) }
        peers[uid] = pc
        return pc
    }

    private fun dropPeer(uid: Int) {
        peers.remove(uid)?.let { runCatching { it.dispose() } }
        offerSent.remove(uid)
    }

    fun dispose() {
        teardown()
        runCatching {
            localAudio?.dispose(); audioSource?.dispose()
            factory?.dispose(); eglBase?.release()
        }
        factory = null; localAudio = null; audioSource = null; eglBase = null
    }

    /** SdpObserver with no-op defaults — override what's needed. */
    private open class SdpAdapter : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(err: String) {
            Log.w("VoiceEngine", "sdp fail: $err") }
        override fun onSetFailure(err: String) {
            Log.w("VoiceEngine", "sdp set fail: $err") }
    }

    /** PeerConnection.Observer with no-op defaults. */
    private open class PeerObserver : PeerConnection.Observer {
        override fun onSignalingChange(s: PeerConnection.SignalingState) {}
        override fun onIceConnectionChange(s: PeerConnection.IceConnectionState) {}
        override fun onIceConnectionReceivingChange(b: Boolean) {}
        override fun onIceGatheringChange(s: PeerConnection.IceGatheringState) {}
        override fun onIceCandidate(c: IceCandidate) {}
        override fun onIceCandidatesRemoved(c: Array<IceCandidate>) {}
        override fun onAddStream(s: MediaStream) {}
        override fun onRemoveStream(s: MediaStream) {}
        override fun onDataChannel(c: DataChannel) {}
        override fun onRenegotiationNeeded() {}
        override fun onAddTrack(r: RtpReceiver, s: Array<MediaStream>) {}
        override fun onTrack(t: org.webrtc.RtpTransceiver) {}
        override fun onConnectionChange(s: PeerConnection.PeerConnectionState) {}
        override fun onRemoveTrack(r: RtpReceiver) {}
    }
}
