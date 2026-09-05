package com.xiaoyang.cuojian;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.graphics.*;
import android.hardware.display.*;
import android.media.*;
import android.media.projection.*;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.util.UUID;

public class CaptureService extends Service {
    static boolean active=false;
    private MediaProjection projection; private VirtualDisplay display; private ImageReader reader;
    private WindowManager wm; private TextView bubble; private View cropView,menu; private Bitmap cropBitmap;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private boolean requested=false,destroying=false; private long notBefore; private int width,height,density,count;
    private String group,role="material",questionId;
    private SharedPreferences prefs(){return getSharedPreferences("capture-session",MODE_PRIVATE);}
    @Override public IBinder onBind(Intent intent){return null;}
    private void persist(){SharedPreferences.Editor e=prefs().edit().putString("group",group).putString("role",role).putString("question",questionId).putInt("count",count);e.commit();updateBubble();}
    private void beginGroup(){if(group!=null){toast("正在继续未结束的本套资料题");return;}group=UUID.randomUUID().toString();role="material";questionId=null;count=0;persist();toast("本套已开始：先截资料，可滚动后继续补图");}
    private void toast(String text){Toast.makeText(this,text,Toast.LENGTH_LONG).show();}
    private void foreground(boolean capturing){
        String channel="cuojian-capture";
        NotificationManager nm=getSystemService(NotificationManager.class);
        if(Build.VERSION.SDK_INT>=26)nm.createNotificationChannel(new NotificationChannel(channel,"悬浮收题",NotificationManager.IMPORTANCE_LOW));
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,CaptureService.class).setAction("stop"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent open=PendingIntent.getActivity(this,2,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder nb=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,channel):new Notification.Builder(this);
        Notification notification=nb.setContentTitle("错见 · 常驻收题入口").setContentText(capturing?"点按截图，长按切换资料/小题或结束本套":"截屏授权已结束，点悬浮入口重新授权").setSmallIcon(android.R.drawable.ic_menu_camera).setContentIntent(open).addAction(android.R.drawable.ic_menu_close_clear_cancel,"关闭悬浮入口",stop).setOngoing(true).build();
        if(Build.VERSION.SDK_INT>=34)startForeground(42,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE|(capturing?ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION:0));
        else if(Build.VERSION.SDK_INT>=29)startForeground(42,notification,capturing?ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION:0);
        else startForeground(42,notification);
    }
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if("stop".equals(intent==null?null:intent.getAction())){prefs().edit().putBoolean("enabled",false).commit();stopSelf();return START_NOT_STICKY;}
        if(intent==null&&!prefs().getBoolean("enabled",false)){stopSelf();return START_NOT_STICKY;}
        try {
            boolean hasPermission=intent!=null&&intent.hasExtra("data");
            foreground(hasPermission||projection!=null);
            if(!active){
                wm=getSystemService(WindowManager.class);
                group=prefs().getString("group",null);role=prefs().getString("role","material");questionId=prefs().getString("question",null);count=prefs().getInt("count",0);
                addBubble();active=true;prefs().edit().putBoolean("enabled",true).commit();
            }
            if(intent!=null&&(intent.getBooleanExtra("group",false)||"group".equals(intent.getAction())))beginGroup();
            if(hasPermission&&projection==null){
                android.util.DisplayMetrics metrics=new android.util.DisplayMetrics();wm.getDefaultDisplay().getRealMetrics(metrics);width=metrics.widthPixels;height=metrics.heightPixels;density=metrics.densityDpi;
                MediaProjectionManager manager=getSystemService(MediaProjectionManager.class);
                projection=manager.getMediaProjection(intent.getIntExtra("code",0),intent.getParcelableExtra("data"));
                projection.registerCallback(new MediaProjection.Callback(){@Override public void onStop(){releaseProjection();if(!destroying){foreground(false);updateBubble();toast("截图授权已结束，悬浮入口保留；点按可重新授权");}} @Override public void onCapturedContentResize(int w,int h){if(w>0&&h>0&&(w!=width||h!=height))resize(w,h);}},handler);
                reader=createReader(width,height);display=projection.createVirtualDisplay("错见收题",width,height,density,DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,reader.getSurface(),null,handler);
            }
            updateBubble();
        }catch(Exception e){releaseProjection();if(active){foreground(false);updateBubble();toast("未能开始截图，点悬浮入口重新授权");}else stopSelf();}
        return START_STICKY;
    }
    private void releaseProjection(){requested=false;if(display!=null){display.release();display=null;}if(reader!=null){reader.close();reader=null;}projection=null;if(bubble!=null)bubble.setVisibility(View.VISIBLE);}
    private ImageReader createReader(int w,int h){
        ImageReader r=ImageReader.newInstance(w,h,PixelFormat.RGBA_8888,2);
        r.setOnImageAvailableListener(source->{try(Image image=source.acquireLatestImage()){
            if(image==null||!requested||SystemClock.uptimeMillis()<notBefore)return;
            requested=false;Image.Plane plane=image.getPlanes()[0];int padded=plane.getRowStride()/plane.getPixelStride();
            Bitmap raw=Bitmap.createBitmap(padded,image.getHeight(),Bitmap.Config.ARGB_8888);raw.copyPixelsFromBuffer(plane.getBuffer());
            Bitmap shot=Bitmap.createBitmap(raw,0,0,image.getWidth(),image.getHeight());if(raw!=shot)raw.recycle();showCrop(shot);
        }catch(Exception e){requested=false;if(bubble!=null)bubble.setVisibility(View.VISIBLE);toast("截图失败，请重试");}},handler);return r;
    }
    private void resize(int w,int h){if(display==null)return;ImageReader previous=reader;reader=createReader(w,h);display.resize(w,h,density);display.setSurface(reader.getSurface());width=w;height=h;if(previous!=null)previous.close();}
    private int overlayType(){return Build.VERSION.SDK_INT>=26?WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY:WindowManager.LayoutParams.TYPE_PHONE;}
    private void updateBubble(){if(bubble!=null)bubble.setText(projection==null?"授权\n长按菜单":group==null?"收题\n长按菜单":("material".equals(role)?"截资料":"截小题")+" · "+count+"\n长按菜单");}
    private void capture(){
        if(projection==null){startActivity(new Intent(this,CapturePermissionActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));return;}
        if(requested||cropView!=null)return;
        bubble.setVisibility(View.INVISIBLE);notBefore=SystemClock.uptimeMillis()+300;requested=true;
        handler.postDelayed(()->{if(requested){requested=false;bubble.setVisibility(View.VISIBLE);toast("无可捕获画面，请检查页面是否禁止截图");}},3000);
    }
    private void addBubble(){
        bubble=new TextView(this);bubble.setTextColor(Color.WHITE);bubble.setTextSize(14);bubble.setPadding(20,16,20,16);bubble.setBackgroundColor(Color.rgb(29,60,65));
        WindowManager.LayoutParams p=new WindowManager.LayoutParams(-2,-2,overlayType(),WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,PixelFormat.TRANSLUCENT);p.gravity=Gravity.TOP|Gravity.LEFT;p.x=20;p.y=180;
        final float[] down=new float[2];final int[] origin=new int[2];final long[] time=new long[1];
        bubble.setOnTouchListener((v,e)->{if(e.getAction()==MotionEvent.ACTION_DOWN){down[0]=e.getRawX();down[1]=e.getRawY();origin[0]=p.x;origin[1]=p.y;time[0]=SystemClock.uptimeMillis();return true;}if(e.getAction()==MotionEvent.ACTION_MOVE){p.x=Math.max(0,Math.min(getResources().getDisplayMetrics().widthPixels-bubble.getWidth(),origin[0]+(int)(e.getRawX()-down[0])));p.y=Math.max(0,Math.min(getResources().getDisplayMetrics().heightPixels-bubble.getHeight(),origin[1]+(int)(e.getRawY()-down[1])));wm.updateViewLayout(bubble,p);return true;}if(e.getAction()==MotionEvent.ACTION_UP){if(Math.abs(e.getRawX()-down[0])+Math.abs(e.getRawY()-down[1])<15){if(SystemClock.uptimeMillis()-time[0]>500)showMenu();else capture();}return true;}return false;});wm.addView(bubble,p);updateBubble();
    }
    private void closeMenu(){if(menu!=null){wm.removeView(menu);menu=null;}}
    private void addAction(LinearLayout box,String title,Runnable action){Button b=new Button(this);b.setText(title);box.addView(b);b.setOnClickListener(v->{closeMenu();action.run();});}
    private void showMenu(){
        if(menu!=null)return;LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(20,20,20,20);box.setBackgroundColor(Color.WHITE);
        if(group==null)addAction(box,"开始一套资料题",()->beginGroup());
        else {
            addAction(box,"截公共资料 / 继续补资料",()->{role="material";persist();capture();});
            addAction(box,"截下一道小题",()->{role="question";questionId=UUID.randomUUID().toString();persist();capture();});
            if(questionId!=null)addAction(box,"给上一道小题补图",()->{role="question";persist();capture();});
            addAction(box,"结束本套（已保存 "+count+" 张）",()->{group=null;questionId=null;count=0;persist();toast("本套已保存。返回待整理箱，按套核对即可；悬浮入口继续保留");});
        }
        addAction(box,"返回继续",()->{});addAction(box,"关闭悬浮入口",()->{prefs().edit().putBoolean("enabled",false).commit();stopSelf();});
        menu=box;WindowManager.LayoutParams p=new WindowManager.LayoutParams(-2,-2,overlayType(),WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,PixelFormat.TRANSLUCENT);p.gravity=Gravity.CENTER;wm.addView(box,p);
    }
    private void closeCrop(){if(cropView!=null){wm.removeView(cropView);cropView=null;}if(cropBitmap!=null){cropBitmap.recycle();cropBitmap=null;}if(bubble!=null)bubble.setVisibility(View.VISIBLE);}
    private void showCrop(Bitmap bitmap){
        cropBitmap=bitmap;LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(Color.rgb(20,20,20));
        TextView hint=new TextView(this);hint.setText("框选后保存；保存后可滚动原页面继续截。本套自动归组。");hint.setTextColor(Color.WHITE);hint.setPadding(16,16,16,16);layout.addView(hint);
        Spinner kind=new Spinner(this);String[] types=group==null?new String[]{"独立题目"}:new String[]{"公共资料（可连续补多张）","新的一道小题","上一小题续图"};
        kind.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,types));kind.setBackgroundColor(Color.WHITE);kind.setSelection(group==null||"material".equals(role)?0:questionId==null?1:2);layout.addView(kind);
        SelectionView selection=new SelectionView(this,bitmap);layout.addView(selection,new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout buttons=new LinearLayout(this);Button save=new Button(this);save.setText("保存，继续截屏");Button again=new Button(this);again.setText("保存，再框本屏");Button cancel=new Button(this);cancel.setText("取消");buttons.addView(save);buttons.addView(again);buttons.addView(cancel);layout.addView(buttons);
        cropView=layout;WindowManager.LayoutParams p=new WindowManager.LayoutParams(-1,-1,overlayType(),WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,PixelFormat.OPAQUE);wm.addView(layout,p);
        cancel.setOnClickListener(v->closeCrop());
        View.OnClickListener saveClick=v->{Bitmap result=null;try{
            String nextRole=group==null?null:kind.getSelectedItemPosition()==0?"material":"question";
            String nextQuestion=questionId;
            if("question".equals(nextRole)&&(kind.getSelectedItemPosition()==1||nextQuestion==null))nextQuestion=UUID.randomUUID().toString();
            result=selection.cropped();CaptureStore.save(this,result,group,nextRole,"question".equals(nextRole)?nextQuestion:null);
            if(group!=null){role=nextRole;questionId=nextQuestion;count++;persist();}
            toast(group==null?"已保存，悬浮入口继续可用":"已加入本套，共 "+count+" 张");
            if(v==again){kind.setSelection(group==null?0:"material".equals(role)?0:1);selection.reset();}else closeCrop();
        }catch(Exception e){toast("保存失败，截图仍在此处，请重试");}finally{if(result!=null&&result!=bitmap)result.recycle();}};
        save.setOnClickListener(saveClick);again.setOnClickListener(saveClick);
    }
    @Override public void onDestroy(){destroying=true;active=false;requested=false;handler.removeCallbacksAndMessages(null);closeMenu();closeCrop();if(wm!=null&&bubble!=null){wm.removeView(bubble);bubble=null;}MediaProjection old=projection;releaseProjection();if(old!=null)old.stop();super.onDestroy();}
    private static class SelectionView extends View {
        Bitmap bitmap;Paint paint=new Paint();RectF image=new RectF(),box=new RectF();float sx,sy;
        SelectionView(Context c,Bitmap b){super(c);bitmap=b;}
        @Override protected void onSizeChanged(int w,int h,int ow,int oh){float s=Math.min((float)w/bitmap.getWidth(),(float)h/bitmap.getHeight());float iw=bitmap.getWidth()*s,ih=bitmap.getHeight()*s;image.set((w-iw)/2,(h-ih)/2,(w+iw)/2,(h+ih)/2);box.set(image);}
        @Override protected void onDraw(Canvas c){paint.setStyle(Paint.Style.FILL);c.drawBitmap(bitmap,null,image,paint);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(4);paint.setColor(Color.CYAN);c.drawRect(box,paint);}
        @Override public boolean onTouchEvent(MotionEvent e){float x=Math.max(image.left,Math.min(image.right,e.getX())),y=Math.max(image.top,Math.min(image.bottom,e.getY()));if(e.getAction()==MotionEvent.ACTION_DOWN){sx=x;sy=y;}else if(e.getAction()==MotionEvent.ACTION_MOVE||e.getAction()==MotionEvent.ACTION_UP){box.set(Math.min(sx,x),Math.min(sy,y),Math.max(sx,x),Math.max(sy,y));invalidate();}return true;}
        void reset(){box.set(image);invalidate();}
        Bitmap cropped(){if(box.width()<8||box.height()<8)throw new IllegalArgumentException();float s=bitmap.getWidth()/image.width();int x=Math.max(0,(int)((box.left-image.left)*s)),y=Math.max(0,(int)((box.top-image.top)*s));return Bitmap.createBitmap(bitmap,x,y,Math.min(bitmap.getWidth()-x,Math.max(1,(int)(box.width()*s))),Math.min(bitmap.getHeight()-y,Math.max(1,(int)(box.height()*s))));}
    }
}
