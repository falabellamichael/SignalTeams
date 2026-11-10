# JNA needs its dispatch classes kept if minify is ever enabled
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
