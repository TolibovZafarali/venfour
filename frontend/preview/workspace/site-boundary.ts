import { routeAudience } from "../../src/app/site-boundary";
export { routeAudience, PUBLIC_ORIGIN, APPLICATION_ORIGIN, PARTNER_ORIGIN } from "../../src/app/site-boundary";
export const hostAudience = () => routeAudience(location.pathname);
export const applicationHref = (path = "/app") => path;
export const publicHref = (path = "/") => path;

export const partnerSignInHref = () => "/partners/sign-in";
