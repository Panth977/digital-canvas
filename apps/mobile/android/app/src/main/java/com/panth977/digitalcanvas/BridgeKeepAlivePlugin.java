package com.panth977.digitalcanvas;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * "Let AI use this device" on Android: while it is on, a foreground service (with its
 * notification) keeps Digital Canvas running when it is in the background, so the
 * web app's device worker keeps answering the AI connector's tool calls.
 *
 * JS: registerPlugin('BridgeKeepAlive').start({ title, text }) / .stop()
 */
@CapacitorPlugin(
    name = "BridgeKeepAlive",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class BridgeKeepAlivePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        // Android 13+: the notification needs permission (the service runs either way; asked once).
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT) {
            requestPermissionForAlias("notifications", call, "afterPermission");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        startService(call);
    }

    private void startService(PluginCall call) {
        Intent i = new Intent(getContext(), BridgeKeepAliveService.class);
        i.putExtra("title", call.getString("title", "Digital Canvas"));
        i.putExtra("text", call.getString("text", "AI can use this phone."));
        try {
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not keep Digital Canvas running: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), BridgeKeepAliveService.class));
        call.resolve();
    }
}
