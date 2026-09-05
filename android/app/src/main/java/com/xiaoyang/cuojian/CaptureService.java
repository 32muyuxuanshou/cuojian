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
    private WindowManager wm; private ImageView bubble; private View cropView,menu; private Bitmap cropBitmap;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private boolean requested=false,destroying=false,captureAsSet=false; private long notBefore; private int width,height,density,count;
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
        Notification notification=nb.setContentTitle("错见 · 常驻收题入口").setContentText(capturing?"点击图标选择截屏或长截屏选题":"截屏授权已结束，点悬浮入口重新授权").setSmallIcon(android.R.drawable.ic_menu_camera).setContentIntent(open).addAction(android.R.drawable.ic_menu_close_clear_cancel,"关闭悬浮入口",stop).setOngoing(true).build();
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
    private int dp(float value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private android.graphics.drawable.GradientDrawable surface(int color,int radius){android.graphics.drawable.GradientDrawable d=new android.graphics.drawable.GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
    private void updateBubble(){
        if(bubble==null)return;
        android.graphics.drawable.GradientDrawable background=surface(Color.rgb(29,60,65),28);
        background.setStroke(dp(2),group!=null?Color.rgb(214,174,109):Color.rgb(235,230,220));bubble.setBackground(background);
        bubble.setAlpha(projection==null?.78f:1f);
        bubble.setContentDescription("错见收题，点击选择截屏或长截屏选题"+(group!=null?"，本套已收录"+count+"张":""));
    }
    private void capture(){
        if(projection==null){startActivity(new Intent(this,CapturePermissionActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));toast("授权后请再次点击图标选择截屏");return;}
        if(requested||cropView!=null)return;
        bubble.setVisibility(View.INVISIBLE);notBefore=SystemClock.uptimeMillis()+300;requested=true;
        handler.postDelayed(()->{if(requested){requested=false;bubble.setVisibility(View.VISIBLE);toast("无可捕获画面，请检查页面是否禁止截图");}},3000);
    }
    private void addBubble(){
        bubble=new ImageView(this);bubble.setImageResource(R.drawable.ic_capture_logo);bubble.setPadding(dp(12),dp(12),dp(12),dp(12));bubble.setElevation(dp(6));
        WindowManager.LayoutParams p=new WindowManager.LayoutParams(dp(52),dp(52),overlayType(),WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,PixelFormat.TRANSLUCENT);p.gravity=Gravity.TOP|Gravity.LEFT;p.x=prefs().getInt("bubbleX",dp(12));p.y=prefs().getInt("bubbleY",dp(150));
        final float[] down=new float[2];final int[] origin=new int[2];final boolean[] moved={false};final int slop=ViewConfiguration.get(this).getScaledTouchSlop();
        bubble.setOnClickListener(v->showMenu());
        bubble.setOnTouchListener((v,e)->{
            if(e.getAction()==MotionEvent.ACTION_DOWN){down[0]=e.getRawX();down[1]=e.getRawY();origin[0]=p.x;origin[1]=p.y;moved[0]=false;return true;}
            if(e.getAction()==MotionEvent.ACTION_MOVE){float dx=e.getRawX()-down[0],dy=e.getRawY()-down[1];if(Math.abs(dx)+Math.abs(dy)>slop)moved[0]=true;if(moved[0]){p.x=Math.max(0,Math.min(getResources().getDisplayMetrics().widthPixels-dp(52),origin[0]+(int)dx));p.y=Math.max(0,Math.min(getResources().getDisplayMetrics().heightPixels-dp(52),origin[1]+(int)dy));wm.updateViewLayout(bubble,p);}return true;}
            if(e.getAction()==MotionEvent.ACTION_UP){if(!moved[0])v.performClick();else{int screen=getResources().getDisplayMetrics().widthPixels;p.x=p.x+dp(26)<screen/2?dp(6):Math.max(0,screen-dp(58));wm.updateViewLayout(bubble,p);prefs().edit().putInt("bubbleX",p.x).putInt("bubbleY",p.y).apply();}return true;}
            return e.getAction()==MotionEvent.ACTION_CANCEL;
        });
        p.x=Math.max(0,Math.min(getResources().getDisplayMetrics().widthPixels-dp(52),p.x));p.y=Math.max(0,Math.min(getResources().getDisplayMetrics().heightPixels-dp(52),p.y));wm.addView(bubble,p);updateBubble();
    }
    private void closeMenu(){if(menu!=null){wm.removeView(menu);menu=null;}}
    private TextView text(String value,int size,int color){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);return t;}
    private LinearLayout menuCard(String title,String subtitle){
        FrameLayout backdrop=new FrameLayout(this);backdrop.setBackgroundColor(0x33000000);backdrop.setOnClickListener(v->closeMenu());
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(20),dp(18),dp(20),dp(14));box.setBackground(surface(Color.rgb(255,252,246),24));box.setElevation(dp(12));box.setOnClickListener(v->{});
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(false);scroll.setVerticalScrollBarEnabled(false);scroll.addView(box);
        FrameLayout.LayoutParams card=new FrameLayout.LayoutParams(Math.min(dp(340),getResources().getDisplayMetrics().widthPixels-dp(32)),-2,Gravity.CENTER);card.topMargin=dp(24);card.bottomMargin=dp(24);backdrop.addView(scroll,card);
        TextView heading=text(title,19,Color.rgb(29,60,65));heading.setTypeface(null,Typeface.BOLD);box.addView(heading);
        TextView note=text(subtitle,12,Color.rgb(107,116,114));note.setPadding(0,dp(6),0,dp(12));box.addView(note);
        menu=backdrop;WindowManager.LayoutParams p=new WindowManager.LayoutParams(-1,-1,overlayType(),WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,PixelFormat.TRANSLUCENT);wm.addView(backdrop,p);return box;
    }
    private void addAction(LinearLayout box,String title,String description,Runnable action){
        LinearLayout row=new LinearLayout(this);row.setOrientation(LinearLayout.VERTICAL);row.setPadding(dp(16),dp(14),dp(16),dp(14));row.setBackground(surface(Color.rgb(234,241,236),16));
        LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2);params.bottomMargin=dp(10);box.addView(row,params);
        TextView label=text(title,16,Color.rgb(29,60,65));label.setTypeface(null,Typeface.BOLD);row.addView(label);
        if(!description.isEmpty()){TextView hint=text(description,12,Color.rgb(93,110,105));hint.setPadding(0,dp(5),0,0);row.addView(hint);}
        row.setFocusable(true);row.setContentDescription(title+"，"+description);row.setOnClickListener(v->{closeMenu();action.run();});
    }
    private void footer(LinearLayout box){TextView dismiss=text("收起",14,Color.rgb(107,116,114));dismiss.setGravity(Gravity.CENTER);dismiss.setMinHeight(dp(48));box.addView(dismiss);dismiss.setOnClickListener(v->closeMenu());}
    private void showMenu(){
        if(menu!=null){closeMenu();return;}
        LinearLayout box=menuCard("错见 · 选题",group==null?"选好题目，剩下的慢慢整理":"长截屏进行中 · 已保存 "+count+" 张，普通截屏不会混入本套");
        addAction(box,"截屏选题","截取当前屏幕，自由框选一道或多道题",()->{captureAsSet=false;capture();});
        addAction(box,"长截屏选题",group==null?"分屏框选、连续补图，资料和小题归为一套":"继续本套资料、小题补图，或完成收录",()->{captureAsSet=true;if(group==null){beginGroup();capture();}else showLongMenu();});
        footer(box);
    }
    private void showLongMenu(){
        LinearLayout box=menuCard("长截屏选题","本套 "+count+" 张 · 手动滚动原页面，再继续框选");
        addAction(box,"继续截资料","多屏资料自动保留在同一套",()->{captureAsSet=true;role="material";persist();capture();});
        addAction(box,"截下一道小题","与上一道题分开记录答案",()->{captureAsSet=true;role="question";questionId=UUID.randomUUID().toString();persist();capture();});
        if(questionId!=null)addAction(box,"给上一小题补图","续接题干、图表或选项",()->{captureAsSet=true;role="question";persist();capture();});
        addAction(box,"完成本套","保存分组，返回待整理箱统一核对",()->{group=null;questionId=null;count=0;captureAsSet=false;persist();toast("本套已保存，请返回待整理箱核对；图标继续保留");});
        footer(box);
    }
    private void closeCrop(){if(cropView!=null){wm.removeView(cropView);cropView=null;}if(cropBitmap!=null){cropBitmap.recycle();cropBitmap=null;}if(bubble!=null)bubble.setVisibility(View.VISIBLE);}
    private void showCrop(Bitmap bitmap){
        final boolean grouped=captureAsSet&&group!=null;
        cropBitmap=bitmap;LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(Color.rgb(20,20,20));
        TextView hint=new TextView(this);hint.setText(grouped?"长截屏 · 拖动框选，保存后滚动原页面继续补图":"截屏选题 · 拖动框选题目，可在本屏连续选多道题");hint.setTextColor(Color.WHITE);hint.setPadding(16,16,16,16);layout.addView(hint);
        Spinner kind=new Spinner(this);String[] types=!grouped?new String[]{"独立题目"}:new String[]{"公共资料（可连续补多张）","新的一道小题","上一小题续图"};
        kind.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,types));kind.setBackgroundColor(Color.WHITE);kind.setSelection(!grouped||"material".equals(role)?0:questionId==null?1:2);layout.addView(kind);
        SelectionView selection=new SelectionView(this,bitmap);layout.addView(selection,new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout buttons=new LinearLayout(this);Button save=new Button(this);save.setText("保存，继续截屏");Button again=new Button(this);again.setText("保存，再框本屏");Button cancel=new Button(this);cancel.setText("取消");for(Button button:new Button[]{save,again,cancel}){button.setTextSize(12);button.setAllCaps(false);button.setMinWidth(0);buttons.addView(button,new LinearLayout.LayoutParams(0,dp(56),1));}layout.addView(buttons);
        cropView=layout;WindowManager.LayoutParams p=new WindowManager.LayoutParams(-1,-1,overlayType(),WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,PixelFormat.OPAQUE);wm.addView(layout,p);
        cancel.setOnClickListener(v->closeCrop());
        View.OnClickListener saveClick=v->{Bitmap result=null;try{
            String nextRole=!grouped?null:kind.getSelectedItemPosition()==0?"material":"question";
            String nextQuestion=questionId;
            if("question".equals(nextRole)&&(kind.getSelectedItemPosition()==1||nextQuestion==null))nextQuestion=UUID.randomUUID().toString();
            result=selection.cropped();CaptureStore.save(this,result,grouped?group:null,nextRole,"question".equals(nextRole)?nextQuestion:null);
            if(grouped){role=nextRole;questionId=nextQuestion;count++;persist();}
            toast(!grouped?"已保存，悬浮入口继续可用":"已加入本套，共 "+count+" 张");
            if(v==again){kind.setSelection(!grouped?0:"material".equals(role)?0:1);selection.reset();}else closeCrop();
        }catch(Exception e){toast("保存失败，截图仍在此处，请重试");}finally{if(result!=null&&result!=bitmap)result.recycle();}};
        save.setOnClickListener(saveClick);again.setOnClickListener(saveClick);
    }
    @Override public void onDestroy(){destroying=true;active=false;requested=false;handler.removeCallbacksAndMessages(null);closeMenu();closeCrop();if(wm!=null&&bubble!=null){wm.removeView(bubble);bubble=null;}MediaProjection old=projection;releaseProjection();if(old!=null)old.stop();super.onDestroy();}
    private static class SelectionView extends View {
        Bitmap bitmap;Paint paint=new Paint();RectF image=new RectF(),box=new RectF();float sx,sy;
        SelectionView(Context c,Bitmap b){super(c);bitmap=b;}
        @Override protected void onSizeChanged(int w,int h,int ow,int oh){float s=Math.min((float)w/bitmap.getWidth(),(float)h/bitmap.getHeight());float iw=bitmap.getWidth()*s,ih=bitmap.getHeight()*s;image.set((w-iw)/2,(h-ih)/2,(w+iw)/2,(h+ih)/2);box.set(image);}
        @Override protected void onDraw(Canvas c){
            paint.setAntiAlias(true);paint.setStyle(Paint.Style.FILL);paint.setColor(Color.WHITE);c.drawBitmap(bitmap,null,image,paint);
            paint.setColor(0x99000000);c.drawRect(image.left,image.top,image.right,box.top,paint);c.drawRect(image.left,box.bottom,image.right,image.bottom,paint);c.drawRect(image.left,box.top,box.left,box.bottom,paint);c.drawRect(box.right,box.top,image.right,box.bottom,paint);
            float d=getResources().getDisplayMetrics().density;paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1.5f*d);paint.setColor(Color.rgb(141,214,189));c.drawRect(box,paint);
            paint.setStrokeWidth(3*d);float arm=Math.min(16*d,Math.min(box.width(),box.height())/3);
            for(float x:new float[]{box.left,box.right})for(float y:new float[]{box.top,box.bottom}){c.drawLine(x,y,x+(x==box.left?arm:-arm),y,paint);c.drawLine(x,y,x,y+(y==box.top?arm:-arm),paint);}
        }
        @Override public boolean onTouchEvent(MotionEvent e){float x=Math.max(image.left,Math.min(image.right,e.getX())),y=Math.max(image.top,Math.min(image.bottom,e.getY()));if(e.getAction()==MotionEvent.ACTION_DOWN){sx=x;sy=y;}else if(e.getAction()==MotionEvent.ACTION_MOVE||e.getAction()==MotionEvent.ACTION_UP){box.set(Math.min(sx,x),Math.min(sy,y),Math.max(sx,x),Math.max(sy,y));invalidate();}return true;}
        void reset(){box.set(image);invalidate();}
        Bitmap cropped(){if(box.width()<8||box.height()<8)throw new IllegalArgumentException();float s=bitmap.getWidth()/image.width();int x=Math.max(0,(int)((box.left-image.left)*s)),y=Math.max(0,(int)((box.top-image.top)*s));return Bitmap.createBitmap(bitmap,x,y,Math.min(bitmap.getWidth()-x,Math.max(1,(int)(box.width()*s))),Math.min(bitmap.getHeight()-y,Math.max(1,(int)(box.height()*s))));}
    }
}
