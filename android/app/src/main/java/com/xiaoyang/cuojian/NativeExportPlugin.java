package com.xiaoyang.cuojian;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;
import java.util.UUID;

/** Transfer bounded chunks across the WebView bridge, then save via Android's document picker. */
@CapacitorPlugin(name="NativeExport")
public class NativeExportPlugin extends Plugin {
    private static final class ExportSession {
        final File file; final String name;
        ExportSession(File file, String name) { this.file=file; this.name=name; }
    }
    private final Map<String,ExportSession> sessions=new ConcurrentHashMap<>();

    @PluginMethod public void begin(PluginCall call) {
        if(!sessions.isEmpty()) { call.reject("已有备份正在导出，请先完成或取消。"); return; }
        String name=call.getString("name", "错见备份.cuojian.zip");
        if(name.length()>150 || name.contains("/") || name.contains("\\") || !name.endsWith(".zip")) { call.reject("备份文件名无效。"); return; }
        try {
            File dir=new File(getContext().getCacheDir(),"backup-exports");
            if(!dir.exists()&&!dir.mkdirs()) throw new java.io.IOException("无法创建备份缓存");
            File[] old=dir.listFiles((d,n)->n.endsWith(".part"));
            if(old!=null) for(File f:old) if(System.currentTimeMillis()-f.lastModified()>86400000L) f.delete();
            String id=UUID.randomUUID().toString(); File file=new File(dir,id+".part");
            if(!file.createNewFile()) throw new java.io.IOException("无法创建缓存文件");
            sessions.put(id,new ExportSession(file,name));JSObject result=new JSObject();result.put("id",id);call.resolve(result);
        } catch(Exception e) { call.reject("无法准备备份，请检查可用空间。",e); }
    }

    @PluginMethod public void append(PluginCall call) {
        ExportSession session=sessions.get(call.getString("id"));String data=call.getString("data");
        if(session==null||data==null||data.length()>750000) { call.reject("备份分块无效。");return; }
        try {
            byte[] bytes=Base64.decode(data,Base64.NO_WRAP);
            if(session.file.length()+bytes.length>800L*1024*1024) throw new java.io.IOException("备份过大");
            try(FileOutputStream out=new FileOutputStream(session.file,true)) {out.write(bytes);}
            call.resolve();
        } catch(Exception e) {call.reject("备份写入失败，请检查可用空间。",e);}
    }

    @PluginMethod public void finish(PluginCall call) {
        ExportSession session=sessions.get(call.getString("id"));
        if(session==null) {call.reject("备份会话已失效。");return;}
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/zip").putExtra(Intent.EXTRA_TITLE,session.name);
        startActivityForResult(call,intent,"saved");
    }

    @ActivityCallback private void saved(PluginCall call,ActivityResult result) {
        if(call==null)return;
        String id=call.getString("id");ExportSession session=sessions.get(id);
        if(session==null) {call.reject("备份会话已失效。");return;}
        if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null) {cleanup(id);JSObject response=new JSObject();response.put("saved",false);call.resolve(response);return;}
        Uri uri=result.getData().getData();
        getBridge().execute(()->{
            try(FileInputStream in=new FileInputStream(session.file);OutputStream out=getContext().getContentResolver().openOutputStream(uri,"w")) {
                if(out==null)throw new java.io.IOException("无法打开目标文件");
                byte[] buffer=new byte[65536];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);
                out.flush();JSObject response=new JSObject();response.put("saved",true);call.resolve(response);
            } catch(Exception e) {call.reject("无法保存备份，请换一个位置重试。",e);} finally {cleanup(id);}
        });
    }

    @PluginMethod public void cancel(PluginCall call) {cleanup(call.getString("id"));call.resolve();}
    private void cleanup(String id) {ExportSession session=sessions.remove(id);if(session!=null)session.file.delete();}
}
