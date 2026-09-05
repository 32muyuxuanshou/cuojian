package com.xiaoyang.cuojian;
import android.app.Activity;
import android.content.Intent;
import android.media.projection.*;
import android.os.*;
import android.widget.Toast;

/** Visible user-triggered permission request, never reuses an expired projection token. */
public class CapturePermissionActivity extends Activity {
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        if(state==null){MediaProjectionManager manager=getSystemService(MediaProjectionManager.class);
            startActivityForResult(Build.VERSION.SDK_INT>=34?manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay()):manager.createScreenCaptureIntent(),71);}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==71){
            if(result==RESULT_OK&&data!=null)androidx.core.content.ContextCompat.startForegroundService(this,new Intent(this,CaptureService.class).putExtra("code",result).putExtra("data",data));
            else Toast.makeText(this,"未开始截屏，悬浮入口和已收录内容保留",Toast.LENGTH_SHORT).show();
            finish();
        }
    }
}
