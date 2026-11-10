package dev.agenthive.watch.device

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.ExerciseTrackedStatus
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseConfig
import com.google.common.util.concurrent.ListenableFuture
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Health Services workout control — "start a run", "pause my workout",
 * "am I working out". Backed by the watch's own exercise stack (Samsung
 * Health on Galaxy Watch), so sessions get real HR/GPS tracking and show
 * up in the health app's history.
 */
object HealthWorkout {

    /** Spoken name → ExerciseType. Null = not a workout phrase. */
    fun typeFor(s: String): ExerciseType? = when {
        s.contains("run") || s.contains("jog") -> ExerciseType.RUNNING
        s.contains("walk") -> ExerciseType.WALKING
        s.contains("bike") || s.contains("cycling") || s.contains("ride") ->
            ExerciseType.BIKING
        s.contains("hike") || s.contains("hiking") -> ExerciseType.HIKING
        s.contains("swim") -> ExerciseType.SWIMMING_POOL
        s.contains("row") -> ExerciseType.ROWING_MACHINE
        s.contains("elliptical") -> ExerciseType.ELLIPTICAL
        s.contains("treadmill") -> ExerciseType.RUNNING_TREADMILL
        s.contains("strength") || s.contains("weights") || s.contains("lift") ->
            ExerciseType.STRENGTH_TRAINING
        s.contains("hiit") -> ExerciseType.HIGH_INTENSITY_INTERVAL_TRAINING
        s.contains("yoga") -> ExerciseType.YOGA
        s.contains("workout") || s.contains("exercise") || s.contains("train") ->
            ExerciseType.WORKOUT
        else -> null
    }

    private fun client(ctx: Context) =
        HealthServices.getClient(ctx).exerciseClient

    private fun granted(ctx: Context) = ContextCompat.checkSelfPermission(
        ctx, Manifest.permission.ACTIVITY_RECOGNITION) ==
        PackageManager.PERMISSION_GRANTED

    /** await() for ListenableFuture without pulling in coroutines-guava. */
    private suspend fun <T> lf(ctx: Context, f: ListenableFuture<T>): T =
        suspendCancellableCoroutine { cont ->
            f.addListener({
                runCatching { f.get() }
                    .onSuccess { cont.resume(it) }
                    .onFailure { cont.resumeWithException(it) }
            }, ContextCompat.getMainExecutor(ctx))
        }

    private fun noGrant(ctx: Context): String {
        runCatching { ctx.startActivity(HealthProbe.grantIntent(ctx)) }
        return "I need Activity recognition and Body sensors — grant them " +
            "for AgentHive here, then ask again."
    }

    suspend fun start(ctx: Context, type: ExerciseType, name: String): String {
        if (!granted(ctx)) return noGrant(ctx)
        return runCatching {
            val ex = client(ctx)
            val caps = lf(ctx, ex.getCapabilitiesAsync())
            if (!caps.supportedExerciseTypes.contains(type)) {
                return@runCatching "This watch can't track that activity — " +
                    "try run, walk, bike or a generic workout."
            }
            lf(ctx, ex.startExerciseAsync(ExerciseConfig.builder(type).build()))
            "Workout started — go!"
        }.getOrElse {
            "Couldn't start the workout — ${it.message?.take(80) ?: "no exercise service"}"
        }
    }

    suspend fun pause(ctx: Context): String = runCatching {
        lf(ctx, client(ctx).pauseExerciseAsync())
        "Workout paused."
    }.getOrElse { "No running workout to pause." }

    suspend fun resume(ctx: Context): String = runCatching {
        lf(ctx, client(ctx).resumeExerciseAsync())
        "Workout resumed."
    }.getOrElse { "No paused workout to resume." }

    suspend fun end(ctx: Context): String = runCatching {
        lf(ctx, client(ctx).endExerciseAsync())
        "Workout ended — nice one."
    }.getOrElse { "No running workout to end." }

    /** Whether an exercise session is live, and which type. */
    suspend fun status(ctx: Context): String {
        if (!granted(ctx)) return noGrant(ctx)
        return runCatching {
            val info = lf(ctx, client(ctx).getCurrentExerciseInfoAsync())
            when (info.exerciseTrackedStatus) {
                ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS ->
                    "Your ${info.exerciseType.name.lowercase()
                        .replace('_', ' ')} workout is running."
                ExerciseTrackedStatus.OTHER_APP_IN_PROGRESS ->
                    "Another app is tracking a workout right now."
                else -> "No workout in progress."
            }
        }.getOrElse { "No workout in progress." }
    }
}
