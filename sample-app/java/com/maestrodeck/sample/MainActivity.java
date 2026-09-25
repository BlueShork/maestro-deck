package com.maestrodeck.sample;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;

public class MainActivity extends Activity {
    @Override protected void onCreate(Bundle s) {
        super.onCreate(s);
        setContentView(R.layout.main);
        final TextView welcome = findViewById(R.id.welcome);
        ((Button) findViewById(R.id.signin)).setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { welcome.setVisibility(View.VISIBLE); }
        });
    }
}
