import { Fragment } from 'react';
import GoogleAd from './GoogleAd';
import { AD_LAYOUT_KEY_FINDER_INFEED, AD_SLOT_FINDER_INFEED, INFEED_EVERY, MAX_INFEED_UNITS } from './ads';

/*
 * A list with in-feed ad units woven in: one after every `every`-th
 * item, at most `max` of them, so a long result list never turns into an ad wall.
 * Items are keyed by position: result lists only ever grow at the end.
 */
export default function AdFeed({
    items, renderItem, every = INFEED_EVERY, max = MAX_INFEED_UNITS,
    slot = AD_SLOT_FINDER_INFEED, layoutKey = AD_LAYOUT_KEY_FINDER_INFEED,
}) {
    const out = [];
    let units = 0;
    items.forEach((item, index) => {
        out.push(<Fragment key={`item-${index}`}>{renderItem(item, index)}</Fragment>);
        if ((index + 1) % every === 0 && units < max) {
            units += 1;
            out.push(<GoogleAd key={`ad-${units}`} format="fluid" slot={slot} layoutKey={layoutKey} minHeight={120} />);
        }
    });
    return out;
}
