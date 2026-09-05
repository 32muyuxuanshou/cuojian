package com.xiaoyang.cuojian;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.text.SimpleDateFormat;
import java.util.*;

@CapacitorPlugin(name="NativeCapture")
public class NativeCapturePlugin extends Plugin {
    @PluginMethod public void start(PluginCall call) {
        if(CaptureService.active) {call.resolve();return;}
        if(!Settings.canDrawOverlays(getContext())) {
            getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getContext().getPackageName())));
            call.reject("请允许错见显示悬浮窗，然后返回再次点击开启。");return;
        }
        MediaProjectionManager manager=(MediaProjectionManager)getContext().getSystemService(android.content.Context.MEDIA_PROJECTION_SERVICE);
        startActivityForResult(call,manager.createScreenCaptureIntent(),"capturePermission");
    }
    @ActivityCallback private void capturePermission(PluginCall call, ActivityResult result) {
        if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null){call.reject("未授权屏幕捕获，不会截取任何内容。");return;}
        Intent intent=new Intent(getContext(),CaptureService.class).putExtra("code",result.getResultCode()).putExtra("data",result.getData());
        androidx.core.content.ContextCompat.startForegroundService(getContext(),intent);call.resolve();
    }
    @PluginMethod public void stop(PluginCall call) {getContext().stopService(new Intent(getContext(),CaptureService.class));call.resolve();}
    @PluginMethod public void pending(PluginCall call) {
        try {
            JSArray images=new JSArray(); File[] files=CaptureStore.directory(getContext()).listFiles((dir,name)->name.endsWith(".png"));
            if(files!=null){Arrays.sort(files,Comparator.comparingLong(File::lastModified));int size=0;
                for(File file:files){if(size>=4)break; // bounded bridge messages; acknowledged files are read in the next batch
                    ByteArrayOutputStream out=new ByteArrayOutputStream();try(FileInputStream in=new FileInputStream(file)){byte[] b=new byte[8192];int n;while((n=in.read(b))>0)out.write(b,0,n);}
                    JSObject item=new JSObject();item.put("id",file.getName().replace(".png",""));item.put("dataUrl","data:image/png;base64,"+android.util.Base64.encodeToString(out.toByteArray(),android.util.Base64.NO_WRAP));
                    SimpleDateFormat date=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);date.setTimeZone(TimeZone.getTimeZone("UTC"));item.put("capturedAt",date.format(new Date(file.lastModified())));images.put(item);size++;
                }
            }
            JSObject result=new JSObject();result.put("images",images);call.resolve(result);
        }catch(Exception e){call.reject("无法读取本地截图",e);}
    }
    @PluginMethod public void acknowledge(PluginCall call) {
        try {JSArray ids=call.getArray("ids");for(int i=0;i<ids.length();i++){String id=ids.getString(i);if(!id.matches("[a-fA-F0-9-]{36}"))continue;File file=new File(CaptureStore.directory(getContext()),id+".png");if(file.exists()&&!file.delete())throw new IOException("无法清理已导入截图");}call.resolve();}catch(Exception e){call.reject("确认导入失败",e);}
    }
}
