package com.xiaoyang.cuojian;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NativeAppUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
