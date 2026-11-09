# Browser extension (desktop Chrome)

Sends the products on the shop page you are looking at (your wishlist, a list) to the Price Tracker app.

Install: Chrome > Extensions > turn on Developer mode > Load unpacked > choose this `extension` folder.
Use: open your wishlist in the shop (you are logged in there), click the extension, enter the app address and your profile name once, click "Send products on this page".

The extension only collects product links from the page you see. The app reads each product page itself. Your shop password never leaves the browser. Link patterns for the shops are in `collect.js`; only Zalando and Answear have been checked against real pages.
