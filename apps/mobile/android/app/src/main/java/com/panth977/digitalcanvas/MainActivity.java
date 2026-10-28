package com.panth977.digitalcanvas;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // "Let AI use this device": keeps the app running in the background (apps/web/src/lib/bridge).
        registerPlugin(BridgeKeepAlivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
