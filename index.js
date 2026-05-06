import { registerRootComponent } from "expo";

// Register background location task before app mounts
import "./services/location-tracking.service";

import App from "@/App";

registerRootComponent(App);
