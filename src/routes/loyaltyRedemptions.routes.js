import { resourceRouter } from "./resource.routes.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
export default resourceRouter(resourceRegistry["loyaltyRedemptions"].service);
