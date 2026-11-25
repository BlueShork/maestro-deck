// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1
package com.maestrodeck.a11ybad;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * One activity, five screens. Pick one with
 * {@code am start -n com.maestrodeck.a11ybad/.MainActivity --es screen <name>}
 * where name is home, form, list, toggles or account (default: account).
 */
public class MainActivity extends Activity {
    @Override protected void onCreate(Bundle s) {
        super.onCreate(s);
        String screen = getIntent().getStringExtra("screen");
        if ("home".equals(screen)) {
            setContentView(R.layout.home);
        } else if ("form".equals(screen)) {
            setContentView(R.layout.form);
        } else if ("list".equals(screen)) {
            setContentView(R.layout.list);
        } else if ("toggles".equals(screen)) {
            setContentView(R.layout.toggles);
            hideState(R.id.alerts_broken);
        } else {
            setContentView(R.layout.account);
            hideState(R.id.notif_broken);
        }
    }

    /**
     * R3 : composant "maison" mal fait. Il reste un Switch à l'écran, mais il
     * annonce aux services d'accessibilité qu'il n'est pas cochable, donc son
     * état n'est jamais lu.
     */
    private void hideState(int id) {
        findViewById(id).setAccessibilityDelegate(new View.AccessibilityDelegate() {
            @Override public void onInitializeAccessibilityNodeInfo(View host, AccessibilityNodeInfo info) {
                super.onInitializeAccessibilityNodeInfo(host, info);
                info.setCheckable(false);
                info.setChecked(false);
            }
        });
    }
}
