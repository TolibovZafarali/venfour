export {formatCommercePrice,buildTotalLossMailto,openHostedCheckout,openPublishedReport} from '../src/features/total-loss-claim/browser-actions';
export function openDefaultEmailApp(mailto:string){window.dispatchEvent(new CustomEvent('synthetic-action',{detail:`Email opening safely recorded for ${decodeURIComponent(mailto.split('?')[0].slice(7))}`}));}
export async function copyPreparedEmail(message:{subject:string;body:string}){window.dispatchEvent(new CustomEvent('synthetic-action',{detail:`Email copy safely recorded: ${message.subject} (${message.body.length} message characters)`}));}
