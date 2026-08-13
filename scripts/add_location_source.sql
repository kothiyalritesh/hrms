Skip to main content
Google Maps Platform
Maps Platform
Overview
Products
Pricing
Documentation

More
Search
/

English
Web
Maps JavaScript API
Get Started
Contact sales
Guides
Reference
Samples
Resources
Legacy
Filter

reviews Get a Maps Demo Key: Try out select Maps JavaScript API and Places UI Kit features at no cost with a Maps Demo Key—no billing information required.
Home
Products
Google Maps Platform
Documentation
Web
Maps JavaScript API
Samples
Send feedbackRetrieving Autocomplete Predictions



Spark icon
Page Summary
This example executes a query prediction request for the phrase "pizza near Syd" and displays the results as an HTML list.

Read the documentation.


TypeScript
JavaScript
CSS
HTML

// This example retrieves autocomplete predictions programmatically from the
// autocomplete service, and displays them as an HTML list.
// This example requires the Places library. Include the libraries=places
// parameter when you first load the API. For example:
// <script src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&libraries=places">
function initService(): void {
  const displaySuggestions = function (
    predictions: google.maps.places.QueryAutocompletePrediction[] | null,
    status: google.maps.places.PlacesServiceStatus
  ) {
    if (status != google.maps.places.PlacesServiceStatus.OK || !predictions) {
      alert(status);
      return;
    }

    predictions.forEach((prediction) => {
      const li = document.createElement("li");

      li.appendChild(document.createTextNode(prediction.description));
      (document.getElementById("results") as HTMLUListElement).appendChild(li);
    });
  };

  const service = new google.maps.places.AutocompleteService();

  service.getQueryPredictions({ input: "pizza near Syd" }, displaySuggestions);
}

declare global {
  interface Window {
    initService: () => void;
  }
}
window.initService = initService;
Note: Read the guide on using TypeScript and Google Maps.
Try Sample
JSFiddle.net
Google Cloud Shell
Clone Sample
Git and Node.js are required to run this sample locally. Follow these instructions to install Node.js and NPM. The following commands clone, install dependencies and start the sample application.

  git clone -b sample-places-queryprediction https://github.com/googlemaps/js-samples.git
  cd js-samples
  npm i
  npm start
Other samples can be tried by switching to any branch beginning with sample-SAMPLE_NAME.

  git checkout sample-SAMPLE_NAME
  npm i
  npm start
Send feedback
Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2026-05-29 UTC.

Stack OverflowStack Overflow
Ask a question under the google-maps tag.
GitHubGitHub
Fork our samples and try them yourself.
DiscordDiscord
Chat with fellow developers about Google Maps Platform.
Issue TrackerIssue Tracker
Something wrong? Send us a bug report!
Learn More
FAQ
Capabilities Explorer
Tutorials
Platforms
Android
iOS
Web
Web Services
Product Info
Pricing and Plans
Contact Sales
Support
Terms of Service
Google Developers
Android
Chrome
Firebase
Google Cloud Platform
Google AI
All products
Terms
Privacy

English


@license

Copyright 2024 Google LLC. All Rights Reserved.

SPDX-License-Identifier: Apache-2.0 */ async function init() { await customElements.whenDefined('gmp-map');

const map = document.querySelector("gmp-map");
const marker = document.getElementById("marker");
const strictBoundsInputElement = document.getElementById("use-strict-bounds");
const placePicker = document.getElementById("place-picker");
const infowindowContent = document.getElementById("infowindow-content");
const infowindow = new google.maps.InfoWindow();

map.innerMap.setOptions({mapTypeControl: false});
infowindow.setContent(infowindowContent);

placePicker.addEventListener('gmpx-placechange', () => {
const place = placePicker.value;

if (!place.location) {
  window.alert(
    "No details available for input: '" + place.name + "'"
  );
  infowindow.close();
  marker.position = null;
  return;
}

if (place.viewport) {
  map.innerMap.fitBounds(place.viewport);
} else {
  map.center = place.location;
  map.zoom = 17;
}

marker.position = place.location;
infowindowContent.children["place-name"].textContent = place.displayName;
infowindowContent.children["place-address"].textContent = place.formattedAddress;
infowindow.open(map.innerMap, marker);

});

// Sets a listener on a radio button to change the filter type on the place picker
function setupClickListener(id, type) {
const radioButton = document.getElementById(id);
radioButton.addEventListener("click", () => {
placePicker.type = type;
});
}
setupClickListener("changetype-all", "");
setupClickListener("changetype-address", "address");
setupClickListener("changetype-establishment", "establishment");
setupClickListener("changetype-geocode", "geocode");
setupClickListener("changetype-cities", "(cities)");
setupClickListener("changetype-regions", "(regions)");

strictBoundsInputElement.addEventListener("change", () => {
placePicker.strictBounds = strictBoundsInputElement.checked;
});
}

document.addEventListener('DOMContentLoaded', init);Skip to main content
Google Maps Platform
Maps Platform
Overview
Products
Pricing
Documentation

More
Search
/

English

Web
Maps JavaScript API
Get Started
Contact sales
Guides
Reference
Samples
Resources
Legacy
Filter

reviews Get a Maps Demo Key: Try out select Maps JavaScript API and Places UI Kit features at no cost with a Maps Demo Key—no billing information required.
Home
Products
Google Maps Platform
Documentation
Web
Maps JavaScript API
Samples
Was this helpful?

Send feedbackPlace Autocomplete

Spark icon
Page Summary
The Place Autocomplete sample demonstrates how to use the Place Autocomplete widget to provide a type-ahead search box.

The radio buttons allow you to filter the types of predictions that the autocomplete returns.
The Strict Bounds option restricts the search to the area within the current viewport. If this option is not checked, then the API biases the search to the current viewport, but it does not restrict it.
When you select an autocomplete result the sample then calls the getPlace() method, and then it opens an info window to display place details.

For more information, see the Autocomplete class.

TypeScript
JavaScript
CSS
HTML
// This example requires the Places library. Include the libraries=places
// parameter when you first load the API. For example:
// <script src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&amp;libraries=places">

function initMap(): void {
const map = new google.maps.Map(
document.getElementById("map") as HTMLElement,
{
center: { lat: 40.749933, lng: -73.98633 },
zoom: 13,
mapTypeControl: false,
}
);
const card = document.getElementById("pac-card") as HTMLElement;
const input = document.getElementById("pac-input") as HTMLInputElement;
const biasInputElement = document.getElementById(
"use-location-bias"
) as HTMLInputElement;
const strictBoundsInputElement = document.getElementById(
"use-strict-bounds"
) as HTMLInputElement;
const options = {
fields: ["formatted_address", "geometry", "name"],
strictBounds: false,
};

map.controls[google.maps.ControlPosition.TOP_LEFT].push(card);

const autocomplete = new google.maps.places.Autocomplete(input, options);

// Bind the map's bounds (viewport) property to the autocomplete object,
// so that the autocomplete requests use the current map bounds for the
// bounds option in the request.
autocomplete.bindTo("bounds", map);

const infowindow = new google.maps.InfoWindow();
const infowindowContent = document.getElementById(
"infowindow-content"
) as HTMLElement;

infowindow.setContent(infowindowContent);

const marker = new google.maps.Marker({
map,
anchorPoint: new google.maps.Point(0, -29),
});

autocomplete.addListener("place_changed", () => {
infowindow.close();
marker.setVisible(false);

const place = autocomplete.getPlace();

if (!place.geometry || !place.geometry.location) {
  // User entered the name of a Place that was not suggested and
  // pressed the Enter key, or the Place Details request failed.
  window.alert("No details available for input: '" + place.name + "'");
  return;
}

// If the place has a geometry, then present it on a map.
if (place.geometry.viewport) {
  map.fitBounds(place.geometry.viewport);
} else {
  map.setCenter(place.geometry.location);
  map.setZoom(17);
}

marker.setPosition(place.geometry.location);
marker.setVisible(true);

infowindowContent.children["place-name"].textContent = place.name;
infowindowContent.children["place-address"].textContent =
  place.formatted_address;
infowindow.open(map, marker);

});

// Sets a listener on a radio button to change the filter type on Places
// Autocomplete.
function setupClickListener(id, types) {
const radioButton = document.getElementById(id) as HTMLInputElement;

radioButton.addEventListener("click", () => {
  autocomplete.setTypes(types);
  input.value = "";
});
}

setupClickListener("changetype-all", []);
setupClickListener("changetype-address", ["address"]);
setupClickListener("changetype-establishment", ["establishment"]);
setupClickListener("changetype-geocode", ["geocode"]);
setupClickListener("changetype-cities", ["(cities)"]);
setupClickListener("changetype-regions", ["(regions)"]);

biasInputElement.addEventListener("change", () => {
if (biasInputElement.checked) {
autocomplete.bindTo("bounds", map);
} else {
// User wants to turn off location bias, so three things need to happen:
// 1. Unbind from map
// 2. Reset the bounds to whole world
// 3. Uncheck the strict bounds checkbox UI (which also disables strict bounds)
autocomplete.unbind("bounds");
autocomplete.setBounds({ east: 180, west: -180, north: 90, south: -90 });
strictBoundsInputElement.checked = biasInputElement.checked;
}

input.value = "";
});

strictBoundsInputElement.addEventListener("change", () => {
autocomplete.setOptions({
strictBounds: strictBoundsInputElement.checked,
});

if (strictBoundsInputElement.checked) {
  biasInputElement.checked = strictBoundsInputElement.checked;
  autocomplete.bindTo("bounds", map);
}

input.value = "";
});
}

declare global {
interface Window {
initMap: () => void;
}
}
window.initMap = initMap;
Note: Read the guide on using TypeScript and Google Maps.
Try Sample
JSFiddle.net
Google Cloud Shell
Clone Sample
Git and Node.js are required to run this sample locally. Follow these instructions to install Node.js and NPM. The following commands clone, install dependencies and start the sample application.

git clone -b sample-places-autocomplete https://github.com/googlemaps/js-samples.git
cd js-samples
npm i
npm start
Other samples can be tried by switching to any branch beginning with sample-SAMPLE_NAME.

git checkout sample-SAMPLE_NAME
npm i
npm start
Use the Place Picker component
The place picker component is a text input that allows end users to search for a specific address or place using autocomplete. It is part of the Extended Component Library, a set of web components that help developers build better maps and location features faster.

Use the Place Picker configurator to create embeddable code for a custom Place Picker component, then export it to be used with popular frameworks like React and Angular or no framework at all.

Was this helpful?

Send feedback
Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2026-05-29 UTC.

Stack OverflowStack Overflow
Ask a question under the google-maps tag.
GitHubGitHub
Fork our samples and try them yourself.
DiscordDiscord
Chat with fellow developers about Google Maps Platform.
Issue TrackerIssue Tracker
Something wrong? Send us a bug report!
Learn More
FAQ
Capabilities Explorer
Tutorials
Platforms
Android
iOS
Web
Web Services
Product Info
Pricing and Plans
Contact Sales
Support
Terms of Service
Google Developers
Android
Chrome
Firebase
Google Cloud Platform
Google AI
All products
Terms
Privacy

Englishremove remove leaflet and add google api to our maps and auto complete for site visits and field visits. Configure the key through EXPO_PUBLIC_GOOGLE_MAPS_API_KEY and restrict it in Google Cloud. Skip to main content
Google Maps Platform
Maps Platform
Overview
Products
Pricing
Documentation

More
Search
/

English

Web Services
Geocoding API
Get Started
Contact sales
Developer Guides v4
Developer Guides v3
Reference
Resources
Filter

Geocoding API v4 methods have a default quota of 25 queries per second (QPS). For information on requesting a higher quota, see View and manage quotas and select Geocoding API as the service.
Home
Products
Google Maps Platform
Documentation
Web Services
Geocoding API
Was this helpful?

Send feedbackSet up the Geocoding API

European Economic Area (EEA) developers
This document describes the steps needed to start using the Geocoding API.

checklist

Account and billing Ensure that you meet the prerequisites.

settings
2. Enable the API
Enable the API in your Google Cloud project.

verified_user
3. Make your first request
Configure an API key or OAuth to make an authenticated API request.

Key Point: This setup guide includes the procedure for both configuring an API key and creating an OAuth token. Choose the procedure that is applicable for your deployment environment.
Google Maps Platform products are secured from unauthorized use by requiring API calls to include either an API key or OAuth token.

API key OAuth token
Get an API key for use with Geocoding API
An API key is a unique alphanumeric string that associates your Cloud Billing account and Google Cloud project with the request your application makes to a Google Maps Platform API or SDK.

To add Geocoding API to an API key:

Console
gcloud
Go to the Google Maps Platform > Keys & Credentials page.

Go to the Keys & Credentials page

If prompted, select an existing project.
The list of available keys appears under API Keys.

If you don't have an API key, or you want to create an API key for use with the Geocoding API, create a new API key:

On the Keys & Credentials page, click + Create credentials > API key.

The API key created dialog displays your newly created API key.

Click the Name of an API key to edit the key.
On the edit page, under Key restrictions:

Under Application restrictions, if any option other than None is selected, only requests originating from those sources are permitted. For more information, see Restrict your API keys.
Under API restrictions:

If Restrict key is selected, select the drop-down box to add the Geocoding API to the API key.
If Don't restrict key is selected, then you can use the API key to make requests to Geocoding API.
Remember to restrict the API key before using it in production.

Select Save.
Select Show key for the key you edited to display the key's alphanumeric string. Pass that string to the example request shown in the next section.
Make an API request
Make a Geocoding API request to return a JSON response for a query on the address "1600 Amphitheatre Parkway, Mountain View, CA". You must include your API key's alphanumeric string with every request and use HTTPS for requests that include the API key.

Click API_KEY in the code below to insert the key's alphanumeric string:

curl -H "X-Goog-Api-Key: API_KEY"
"https://geocode.googleapis.com/v4/geocode/address/1600+Amphitheatre+Parkway,+Mountain+View,+CA&quot;&gt;&#39;
Click the copy icon in the code sample, Select the copy icon., to copy the curl command.
Paste the command in a terminal window and run the command.
The response is a JSON object in the form:

{
"results": [
{
"place": "//places.googleapis.com/places/ChIJxQvW8wK6j4AR3ukttGy3w2s",
"placeId": "ChIJxQvW8wK6j4AR3ukttGy3w2s",
"location": {
"latitude": 37.4224119,
"longitude": -122.08550779999999
},
"granularity": "ROOFTOP",
"viewport": {
"low": {
"latitude": 37.420886519708496,
"longitude": -122.08713963029149
},
"high": {
"latitude": 37.423584480291495,
"longitude": -122.0844416697085
}
},
"formattedAddress": "Google Building 41, 1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
"postalAddress": {
"regionCode": "US",
"languageCode": "en",
"postalCode": "94043-1351",
"administrativeArea": "CA",
"locality": "Mountain View",
"addressLines": [
"1600 Amphitheatre Pkwy"
]
},
"addressComponents": [
{
"longText": "Google Building 41",
"shortText": "Google Building 41",
"types": [
"premise"
],
"languageCode": "en"
},
{
"longText": "1600",
"shortText": "1600",
"types": [
"street_number"
]
},
{
"longText": "Amphitheatre Parkway",
"shortText": "Amphitheatre Pkwy",
"types": [
"route"
],
"languageCode": "en"
},
{
"longText": "Mountain View",
"shortText": "Mountain View",
"types": [
"locality",
"political"
],
"languageCode": "en"
},
{
"longText": "Santa Clara County",
"shortText": "Santa Clara County",
"types": [
"administrative_area_level_2",
"political"
],
"languageCode": "en"
},
{
"longText": "California",
"shortText": "CA",
"types": [
"administrative_area_level_1",
"political"
],
"languageCode": "en"
},
{
"longText": "United States",
"shortText": "US",
"types": [
"country",
"political"
],
"languageCode": "en"
},
{
"longText": "94043",
"shortText": "94043",
"types": [
"postal_code"
]
},
{
"longText": "1351",
"shortText": "1351",
"types": [
"postal_code_suffix"
]
}
],
"types": [
"premise",
"street_address"
]
}
]
}
Apply API key restrictions
Caution: An unrestricted API key can be used to make a request to any Google Maps Platform service, including the Geocoding API. Google strongly recommends that you restrict your API keys by limiting their usage to only those APIs needed for your application. Restricting API keys adds security to your application by protecting it from unwarranted requests. For more information, see Restrict your API key.
Google strongly recommends that you restrict your API keys by limiting their usage to those only APIs needed for your application. Restricting API keys adds security to your application by protecting it from unwarranted requests. You are financially responsible for charges caused by abuse of unrestricted API keys. For more information, see Google Maps Platform security guidance.

API keys support two types of restrictions:

API restrictions specify which SDKs and APIs can be called using the API key.
Application restrictions specify which websites, IP addresses, or apps can use an API key.
For more information on applying restrictions, see Restrict your API keys.

Was this helpful?

Send feedback
Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License. For details, see the Google Developers Site Policies. Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2026-05-29 UTC.

Stack OverflowStack Overflow
Ask a question under the google-maps tag.
GitHubGitHub
Fork our samples and try them yourself.
DiscordDiscord
Chat with fellow developers about Google Maps Platform.
Issue TrackerIssue Tracker
Something wrong? Send us a bug report!
Learn More
FAQ
Capabilities Explorer
API security best practices
Optimizing Web Service Usage
Platforms
Android
iOS
Web
Web Services
Product Info
Pricing and Plans
Contact Sales
Support
Terms of Service
Google Developers
Android
Chrome
Firebase
Google Cloud Platform
Google AI
All products
Terms
Privacy

English
The new page has loaded..|

use this data for geolocation and maps


