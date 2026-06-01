package za.co.leanliving.floor;

import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Always-live: the app loads the production web app from the server. If the device
    // can't reach it at launch (no Wi-Fi), fall back to the bundled offline page instead
    // of a blank/error WebView. Extending BridgeWebViewClient keeps the Capacitor bridge
    // (and native plugins like the barcode scanner) fully working.
    final WebView webView = getBridge().getWebView();
    webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request != null && request.isForMainFrame()) {
          view.loadUrl("file:///android_asset/public/offline.html");
        } else {
          super.onReceivedError(view, request, error);
        }
      }
    });
  }
}
