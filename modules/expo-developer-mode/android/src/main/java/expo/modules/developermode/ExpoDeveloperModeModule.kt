package expo.modules.developermode

import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoDeveloperModeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoDeveloperMode")
    AsyncFunction("isDeveloperModeEnabled") {
      val resolver = appContext.reactContext?.contentResolver
      if (resolver == null) false else
        Settings.Global.getInt(resolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1
    }
  }
}
