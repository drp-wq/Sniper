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
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
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
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(false);
        settings.setSaveFormData(false);

        webView.setWebViewClient(new SafeWebViewClient(this.getApplicationContext()));
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

        // assertLocalContext() enforces top-level URL and pairs with SafeWebViewClient.shouldInterceptRequest to ensure no remote frame or subresource can ever execute.
        private void assertLocalContext() {
            String currentUrl = webView.getUrl();
            if (currentUrl == null || !currentUrl.startsWith("file:///android_asset/")) {
                throw new SecurityException("Bridge restricted to local app assets");
            }
        }

        private static boolean isInvalidHost(String host) {
            if (host == null || host.trim().isEmpty()) return true;
            String h = host.toLowerCase().trim();
            if ("localhost".equals(h) || h.endsWith(".localhost") || "127.0.0.1".equals(h) ||
                "169.254.169.254".equals(h) || "metadata.google.internal".equals(h)) {
                return true;
            }
            if (h.contains(":") || h.startsWith("[") || h.endsWith("]")) {
                return true;
            }
            if (h.matches("^(?:\\d+|0x[0-9a-fA-F]+|\\d+\\.\\d+\\.\\d+\\.\\d+|\\[.*\\])$")) {
                return true;
            }
            return false;
        }

        private static boolean isValidHttpsUrl(String urlStr) {
            if (urlStr == null || urlStr.trim().isEmpty()) return false;
            try {
                URL u = new URL(urlStr.trim());
                if (!"https".equalsIgnoreCase(u.getProtocol())) return false;
                if (u.getUserInfo() != null) return false;
                int port = u.getPort();
                if (port != -1 && port != 443) return false;
                String host = u.getHost();
                if (host == null || isInvalidHost(host)) return false;
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void saveConfig(String json) {
            assertLocalContext();
            if (json == null || json.trim().isEmpty()) {
                SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit().putString(KEY_CFG, "").apply();
                return;
            }
            try {
                JSONObject cfg = new JSONObject(json);
                if (cfg.has("workerUrl")) {
                    String wUrl = cfg.optString("workerUrl", "");
                    if (!wUrl.isEmpty() && !isValidHttpsUrl(wUrl)) {
                        cfg.remove("workerUrl");
                    }
                }
                if (cfg.has("rpcUrl")) {
                    String rUrl = cfg.optString("rpcUrl", "");
                    if (!rUrl.isEmpty() && !isValidHttpsUrl(rUrl)) {
                        cfg.remove("rpcUrl");
                    }
                }
                SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit().putString(KEY_CFG, cfg.toString()).apply();
            } catch (Exception ignored) {}
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
                int port = url.getPort();
                if (port != -1 && port != 443) {
                    throw new SecurityException("Non-standard HTTPS port not permitted: " + port);
                }
                String host = url.getHost() != null ? url.getHost().toLowerCase() : "";
                if (isInvalidHost(host)) {
                    throw new SecurityException("Invalid target host: " + host);
                }

                // Dynamically resolve configured Worker and RPC hosts from local SharedPreferences
                String configuredWorkerHost = "";
                String configuredRpcHost = "api.mainnet-beta.solana.com";
                try {
                    SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                    String rawCfg = prefs.getString(KEY_CFG, "");
                    if (!rawCfg.isEmpty()) {
                        JSONObject cfg = new JSONObject(rawCfg);
                        String wUrl = cfg.optString("workerUrl", "");
                        String rUrl = cfg.optString("rpcUrl", "");
                        if (!wUrl.isEmpty() && isValidHttpsUrl(wUrl)) configuredWorkerHost = new URL(wUrl).getHost().toLowerCase();
                        if (!rUrl.isEmpty() && isValidHttpsUrl(rUrl)) configuredRpcHost = new URL(rUrl).getHost().toLowerCase();
                    }
                } catch (Exception ignored) {}

                boolean allowedHost = host.equals("api.dexscreener.com") ||
                        (!configuredWorkerHost.isEmpty() && host.equals(configuredWorkerHost)) ||
                        host.equals(configuredRpcHost);
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
                        String lowerK = k.toLowerCase().trim();
                        if ("content-type".equals(lowerK) || "accept".equals(lowerK) || "x-key".equals(lowerK)) {
                            String v = headersObj.optString(k, "");
                            if (!v.isEmpty()) {
                                conn.setRequestProperty(k, v);
                            }
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
                        int totalBytes = 0;
                        final int MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MB cap
                        while ((n = in.read(buf)) != -1) {
                            totalBytes += n;
                            if (totalBytes > MAX_RESPONSE_BYTES) {
                                throw new SecurityException("Response size exceeds 1 MB limit");
                            }
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
                    err.put("error", "bridge_http_request_failed");
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

    private static class SafeWebViewClient extends WebViewClient {
        private final Context appContext;

        SafeWebViewClient(Context context) {
            this.appContext = context;
        }

        private boolean handleUrl(Uri uri) {
            if (uri == null) return true;
            String url = uri.toString();
            if (url.startsWith("file:///android_asset/")) {
                return false;
            }
            if ("https".equalsIgnoreCase(uri.getScheme())) {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    appContext.startActivity(intent);
                } catch (Exception ignored) {}
                return true;
            }
            return true;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (url == null) return true;
            return handleUrl(Uri.parse(url));
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (request == null || request.getUrl() == null) return true;
            return handleUrl(request.getUrl());
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request == null || request.getUrl() == null) {
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", null, new ByteArrayInputStream(new byte[0]));
            }
            String url = request.getUrl().toString();
            if (url.startsWith("file:///android_asset/")) {
                return null; // Allow local bundled assets
            }
            // Strictly block all remote subresources, scripts, iframes, and fonts
            return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", null, new ByteArrayInputStream(new byte[0]));
        }

        @Override
        @SuppressWarnings("deprecation")
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            if (url != null && url.startsWith("file:///android_asset/")) {
                return null;
            }
            return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", null, new ByteArrayInputStream(new byte[0]));
        }
    }
}
