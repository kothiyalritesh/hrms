import { registerRootComponent } from "expo";

// Must be imported before App so TaskManager can register both native tasks.
import "@/services/location/backgroundLocationTask";

import App from "@/App";

registerRootComponent(App);
