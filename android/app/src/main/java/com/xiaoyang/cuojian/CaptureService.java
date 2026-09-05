package com.xiaoyang.cuojian;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.hardware.display.*;
import android.media.*;
import android.media.projection.*;
import android.os.*;
import android.view.*;
import android.widget.*;

public class CaptureService extends Service {
    static boolean active=false;
    private MediaProjection projection; private VirtualDisplay display; private ImageReader reader;
    private WindowManager wm; private TextView bubble; private View cropView;
    private Handler handler=new Handler(Looper.getMainLooper());
    private boolean requested=false; private long notBefore; private int width,height,density;
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if("stop".equals(intent==null?null:intent.getAction())){stopSelf();return START_NOT_STICKY;}
        if(active)return START_NOT_STICKY;
        try {
            String channel="cuojian-capture";
            NotificationManager nm=getSystemService(NotificationManager.class);
            if(Build.VERSION.SDK_INT>=26)nm.createNotificationChannel(new NotificationChannel(channel,"悬浮收题",NotificationManager.IMPORTANCE_LOW));
            PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,CaptureService.class).setAction("stop"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder nb=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,channel):new Notification.Builder(this);
            startForeground(42,nb.setContentTitle("错见 · 悬浮收题已开启").setContentText("点击悬浮按钮截取；拖动移动，长按收起。可随时停止。").setSmallIcon(android.R.drawable.ic_menu_camera).addAction(android.R.drawable.ic_menu_close_clear_cancel,"停止收题",stop).setOngoing(true).build());
            wm=getSystemService(WindowManager.class);
            android.util.DisplayMetrics metrics=new android.util.DisplayMetrics();wm.getDefaultDisplay().getRealMetrics(metrics);width=metrics.widthPixels;height=metrics.heightPixels;density=metrics.densityDpi;
            MediaProjectionManager manager=getSystemService(MediaProjectionManager.class);
            if(intent==null)throw new IllegalStateException();
            projection=manager.getMediaProjection(intent.getIntExtra("code",0),intent.getParcelableExtra("data"));
            projection.registerCallback(new MediaProjection.Callback(){@Override public void onStop(){stopSelf();} @Override public void onCapturedContentResize(int w,int h){if(w>0&&h>0&&(w!=width||h!=height))resize(w,h);}},handler);
            reader=createReader(width,height);
            display=projection.createVirtualDisplay("错见收题",width,height,density,DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,reader.getSurface(),null,handler);
            addBubble();active=true;
        }catch(Exception e){Toast.makeText(this,"无法开启收题，请重新授权屏幕捕获",Toast.LENGTH_LONG).show();stopSelf();}
        return START_NOT_STICKY;
    }
    private ImageReader createReader(int w,int h){
        ImageReader r=ImageReader.newInstance(w,h,PixelFormat.RGBA_8888,2);
        r.setOnImageAvailableListener(source->{
            try(Image image=source.acquireLatestImage()){
                if(image==null||!requested||SystemClock.uptimeMillis()<notBefore)return;
                requested=false;
                Image.Plane plane=image.getPlanes()[0];int stride=plane.getPixelStride();int padded=plane.getRowStride()/stride;
                Bitmap raw=Bitmap.createBitmap(padded,image.getHeight(),Bitmap.Config.ARGB_8888);raw.copyPixelsFromBuffer(plane.getBuffer());
                Bitmap shot=Bitmap.createBitmap(raw,0,0,image.getWidth(),image.getHeight());if(raw!=shot)raw.recycle();
                showCrop(shot);
            }catch(Exception e){requested=false;if(bubble!=null)bubble.setVisibility(View.VISIBLE);Toast.makeText(this,"截图失败，请重试",Toast.LENGTH_SHORT).show();}
        },handler);return r;
    }
    private void resize(int w,int h){if(display==null)return;ImageReader previous=reader;reader=createReader(w,h);display.resize(w,h,density);display.setSurface(reader.getSurface());width=w;height=h;if(previous!=null)previous.close();}
    private int overlayType(){return Build.VERSION.SDK_INT>=26?WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY:WindowManager.LayoutParams.TYPE_PHONE;}
    private void addBubble(){
        bubble=new TextView(this);bubble.setText("收题");bubble.setTextColor(Color.WHITE);bubble.setTextSize(16);bubble.setPadding(22,18,22,18);bubble.setBackgroundColor(Color.rgb(29,60,65));
        WindowManager.LayoutParams p=new WindowManager.LayoutParams(-2,-2,overlayType(),WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,PixelFormat.TRANSLUCENT);p.gravity=Gravity.TOP|Gravity.LEFT;p.x=20;p.y=180;
        final float[] down=new float[2];final int[] origin=new int[2];final long[] time=new long[1];
        bubble.setOnTouchListener((v,e)->{if(e.getAction()==MotionEvent.ACTION_DOWN){down[0]=e.getRawX();down[1]=e.getRawY();origin[0]=p.x;origin[1]=p.y;time[0]=SystemClock.uptimeMillis();return true;}if(e.getAction()==MotionEvent.ACTION_MOVE){p.x=origin[0]+(int)(e.getRawX()-down[0]);p.y=origin[1]+(int)(e.getRawY()-down[1]);wm.updateViewLayout(bubble,p);return true;}if(e.getAction()==MotionEvent.ACTION_UP){if(Math.abs(e.getRawX()-down[0])+Math.abs(e.getRawY()-down[1])<15){if(SystemClock.uptimeMillis()-time[0]>500){bubble.setText(bubble.getText().length()>1?"题":"收题");}else if(!requested){bubble.setVisibility(View.INVISIBLE);notBefore=SystemClock.uptimeMillis()+300;requested=true;handler.postDelayed(()->{if(requested){requested=false;bubble.setVisibility(View.VISIBLE);Toast.makeText(this,"没有可捕获画面，请检查授权或页面是否禁止截图",Toast.LENGTH_LONG).show();}},3000);}}return true;}return false;});
        wm.addView(bubble,p);
    }
    private void showCrop(Bitmap bitmap){
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(Color.rgb(20,20,20));
        TextView hint=new TextView(this);hint.setText("拖动框选题目（保留材料与选项），然后保存");hint.setTextColor(Color.WHITE);hint.setPadding(16,16,16,16);layout.addView(hint);
        SelectionView selection=new SelectionView(this,bitmap);layout.addView(selection,new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout buttons=new LinearLayout(this);Button save=new Button(this);save.setText("保存到待整理箱");Button cancel=new Button(this);cancel.setText("取消");buttons.addView(save);buttons.addView(cancel);layout.addView(buttons);
        cropView=layout;WindowManager.LayoutParams p=new WindowManager.LayoutParams(-1,-1,overlayType(),WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,PixelFormat.OPAQUE);wm.addView(layout,p);
        Runnable close=()->{if(cropView!=null){wm.removeView(cropView);cropView=null;}bitmap.recycle();if(bubble!=null)bubble.setVisibility(View.VISIBLE);};
        cancel.setOnClickListener(v->close.run());save.setOnClickListener(v->{try{Bitmap result=selection.cropped();CaptureStore.save(this,result);if(result!=bitmap)result.recycle();Toast.makeText(this,"已存入待整理箱，可继续收题",Toast.LENGTH_SHORT).show();close.run();}catch(Exception e){Toast.makeText(this,"保存失败，请检查剩余空间后重试",Toast.LENGTH_LONG).show();}});
    }
    @Override public void onDestroy(){active=false;requested=false;handler.removeCallbacksAndMessages(null);if(wm!=null){if(bubble!=null)wm.removeView(bubble);if(cropView!=null)wm.removeView(cropView);}if(display!=null)display.release();if(reader!=null)reader.close();if(projection!=null){MediaProjection p=projection;projection=null;p.stop();}super.onDestroy();}
    private static class SelectionView extends View {
        Bitmap bitmap;Paint paint=new Paint();RectF image=new RectF(),box=new RectF();float sx,sy;
        SelectionView(Context c,Bitmap b){super(c);bitmap=b;}
        @Override protected void onSizeChanged(int w,int h,int ow,int oh){float s=Math.min((float)w/bitmap.getWidth(),(float)h/bitmap.getHeight());float iw=bitmap.getWidth()*s,ih=bitmap.getHeight()*s;image.set((w-iw)/2,(h-ih)/2,(w+iw)/2,(h+ih)/2);box.set(image);}
        @Override protected void onDraw(Canvas c){paint.setStyle(Paint.Style.FILL);c.drawBitmap(bitmap,null,image,paint);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(4);paint.setColor(Color.CYAN);c.drawRect(box,paint);}
        @Override public boolean onTouchEvent(MotionEvent e){float x=Math.max(image.left,Math.min(image.right,e.getX())),y=Math.max(image.top,Math.min(image.bottom,e.getY()));if(e.getAction()==MotionEvent.ACTION_DOWN){sx=x;sy=y;}else if(e.getAction()==MotionEvent.ACTION_MOVE||e.getAction()==MotionEvent.ACTION_UP){box.set(Math.min(sx,x),Math.min(sy,y),Math.max(sx,x),Math.max(sy,y));invalidate();}return true;}
        Bitmap cropped(){if(box.width()<8||box.height()<8)throw new IllegalArgumentException();float s=bitmap.getWidth()/image.width();int x=Math.max(0,(int)((box.left-image.left)*s)),y=Math.max(0,(int)((box.top-image.top)*s));return Bitmap.createBitmap(bitmap,x,y,Math.min(bitmap.getWidth()-x,Math.max(1,(int)(box.width()*s))),Math.min(bitmap.getHeight()-y,Math.max(1,(int)(box.height()*s))));}
    }
}
