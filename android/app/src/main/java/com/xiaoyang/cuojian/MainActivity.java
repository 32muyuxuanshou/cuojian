package com.xiaoyang.cuojian;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NativeAppUpdatePlugin.class);
        registerPlugin(NativeCapturePlugin.class);
        super.onCreate(savedInstanceState);
        CaptureStore.receive(this, getIntent());
    }
    @Override public void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        CaptureStore.receive(this, intent);
    }
}
