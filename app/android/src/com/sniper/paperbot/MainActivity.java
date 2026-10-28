package com.sniper.paperbot;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

public class MainActivity extends Activity {
    private static final String PREFS_NAME = "sniper_paper_prefs";
    private static final String KEY_CFG = "cfg_json";
    private static final String KEY_STATE = "state_json";
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.parseColor("#080C14"));
        getWindow().setNavigationBarColor(Color.parseColor("#080C14"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#080C14"));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return true;
                if (url.startsWith("file:///android_asset/")) {
                    return false;
                }
                Uri uri = Uri.parse(url);
                if ("https".equalsIgnoreCase(uri.getScheme())) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        startActivity(intent);
                    } catch (Exception ignored) {}
                    return true;
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new AndroidBridge(this, webView), "AndroidBridge");

        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    public static class AndroidBridge {
        private final Context context;
        private final WebView webView;

        public AndroidBridge(Context ctx, WebView webView) {
            this.context = ctx.getApplicationContext();
            this.webView = webView;
        }

        private void assertLocalContext() {
            String currentUrl = webView.getUrl();
            if (currentUrl == null || !currentUrl.startsWith("file:///android_asset/")) {
                throw new SecurityException("Bridge restricted to local app assets");
            }
        }

        @JavascriptInterface
        public void saveConfig(String json) {
            assertLocalContext();
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY_CFG, json != null ? json : "").apply();
        }

        @JavascriptInterface
        public String loadConfig() {
            assertLocalContext();
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            return prefs.getString(KEY_CFG, "");
        }

        @JavascriptInterface
        public void saveState(String json) {
            assertLocalContext();
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY_STATE, json != null ? json : "").apply();
        }

        @JavascriptInterface
        public String loadState() {
            assertLocalContext();
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            return prefs.getString(KEY_STATE, "");
        }

        @JavascriptInterface
        public String httpRequest(String urlStr, String method, String headersJson, String bodyStr) {
            assertLocalContext();
            HttpURLConnection conn = null;
            try {
                URL url = new URL(urlStr);
                if (!"https".equalsIgnoreCase(url.getProtocol())) {
                    throw new SecurityException("Only HTTPS permitted in native bridge");
                }
                if (url.getUserInfo() != null) {
                    throw new SecurityException("URL credentials not permitted");
                }
                String host = url.getHost() != null ? url.getHost().toLowerCase() : "";
                boolean allowedHost = host.equals("api.dexscreener.com") ||
                        host.endsWith(".workers.dev") ||
                        host.endsWith(".helius-rpc.com") ||
                        host.endsWith(".quiknode.pro") ||
                        host.equals("api.mainnet-beta.solana.com");
                if (!allowedHost) {
                    throw new SecurityException("Target host not permitted: " + host);
                }

                conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(false);
                String cleanMethod = (method != null && !method.trim().isEmpty())
                        ? method.trim().toUpperCase()
                        : "GET";
                if (!"GET".equals(cleanMethod) && !"POST".equals(cleanMethod) && !"HEAD".equals(cleanMethod)) {
                    throw new SecurityException("Method not allowed: " + cleanMethod);
                }
                conn.setRequestMethod(cleanMethod);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setUseCaches(false);

                if (headersJson != null && !headersJson.trim().isEmpty()) {
                    JSONObject headersObj = new JSONObject(headersJson);
                    Iterator<String> keys = headersObj.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        String v = headersObj.optString(k, "");
                        if (!v.isEmpty()) {
                            conn.setRequestProperty(k, v);
                        }
                    }
                }

                if (!"GET".equals(cleanMethod) && !"HEAD".equals(cleanMethod)
                        && bodyStr != null && !bodyStr.isEmpty()) {
                    conn.setDoOutput(true);
                    byte[] payload = bodyStr.getBytes(StandardCharsets.UTF_8);
                    conn.setFixedLengthStreamingMode(payload.length);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(payload);
                        os.flush();
                    }
                }

                int status = conn.getResponseCode();
                InputStream is = (status >= 200 && status < 400)
                        ? conn.getInputStream()
                        : conn.getErrorStream();

                String respText = "";
                if (is != null) {
                    try (InputStream in = is; ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
                        byte[] buf = new byte[4096];
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            bos.write(buf, 0, n);
                        }
                        respText = bos.toString("UTF-8");
                    }
                }

                JSONObject out = new JSONObject();
                out.put("ok", status >= 200 && status < 300);
                out.put("status", status);
                out.put("body", respText);
                return out.toString();
            } catch (Exception e) {
                try {
                    JSONObject err = new JSONObject();
                    err.put("ok", false);
                    err.put("status", 0);
                    err.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                    return err.toString();
                } catch (Exception ignored) {
                    return "{\"ok\":false,\"status\":0,\"error\":\"bridge_exception\"}";
                }
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }
    }
}
