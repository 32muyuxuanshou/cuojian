package com.xiaoyang.cuojian;

import android.content.*;
import android.net.Uri;
import android.graphics.*;
import java.io.*;
import java.util.*;

final class CaptureStore {
    static File directory(Context context) { File dir=new File(context.getFilesDir(), "capture-inbox"); dir.mkdirs(); return dir; }
    static synchronized String save(Context context, Bitmap bitmap) throws IOException {
        String id=UUID.randomUUID().toString();
        File temp=new File(directory(context),id+".tmp");
        try(FileOutputStream out=new FileOutputStream(temp)) { if(!bitmap.compress(Bitmap.CompressFormat.PNG,100,out)) throw new IOException("图片保存失败"); out.getFD().sync(); }
        if(!temp.renameTo(new File(directory(context),id+".png"))) throw new IOException("图片保存失败");
        return id;
    }
    static void receive(Context context, Intent intent) {
        if(intent==null || (!Intent.ACTION_SEND.equals(intent.getAction()) && !Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction()))) return;
        ArrayList<Uri> uris=new ArrayList<>();
        if(Intent.ACTION_SEND.equals(intent.getAction())) { Uri uri=intent.getParcelableExtra(Intent.EXTRA_STREAM); if(uri!=null) uris.add(uri); }
        else { ArrayList<Uri> values=intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM); if(values!=null) uris.addAll(values); }
        // Consume this intent once. Copies are private and survive process termination.
        intent.setAction(null);
        new Thread(()->{
            for(Uri uri:uris) try(InputStream in=context.getContentResolver().openInputStream(uri)) {
                if(in==null) continue;
                ByteArrayOutputStream bytes=new ByteArrayOutputStream(); byte[] buffer=new byte[8192]; int n;
                while((n=in.read(buffer))>0) { bytes.write(buffer,0,n); if(bytes.size()>12*1024*1024) throw new IOException("图片过大"); }
                byte[] data=bytes.toByteArray(); BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(data,0,data.length,bounds);
                BitmapFactory.Options opts=new BitmapFactory.Options();opts.inSampleSize=Math.max(1,Math.max(bounds.outWidth,bounds.outHeight)/3000);
                Bitmap bitmap=BitmapFactory.decodeByteArray(data,0,data.length,opts); if(bitmap!=null){save(context,bitmap);bitmap.recycle();}
            } catch(Exception ignored) { new android.os.Handler(android.os.Looper.getMainLooper()).post(()->android.widget.Toast.makeText(context,"部分图片未能导入，请打开待整理箱核对后重试",android.widget.Toast.LENGTH_LONG).show()); }
        }).start();
    }
}
