package expo.modules.stockroomdownloads

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class StockroomDownloadsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StockroomDownloads")

    AsyncFunction("saveAsync") { sourceUri: String, filename: String, mimeType: String ->
      check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        "Saving directly to Downloads requires Android 10 or later."
      }
      val context = appContext.reactContext ?: error("App context is unavailable.")
      val source = Uri.parse(sourceUri)
      require(source.scheme == "file") { "Expected a local report file." }
      require(filename == File(filename).name && filename.isNotBlank()) { "Invalid report name." }
      val input = File(requireNotNull(source.path)).canonicalFile
      require(input.path.startsWith(context.cacheDir.canonicalPath + File.separator)) {
        "Report must be in the app cache."
      }
      val resolver = context.contentResolver
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
        put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
      val destination = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: error("Could not create the report in Downloads.")
      try {
        input.inputStream().use { from ->
          (resolver.openOutputStream(destination) ?: error("Could not write the report.")).use { to ->
            from.copyTo(to)
          }
        }
        val published = resolver.update(destination, ContentValues().apply {
          put(MediaStore.MediaColumns.IS_PENDING, 0)
        }, null, null)
        check(published == 1) { "Could not finish saving the report." }
        destination.toString()
      } catch (error: Exception) {
        try { resolver.delete(destination, null, null) } catch (_: Exception) { }
        throw error
      }
    }
  }
}
