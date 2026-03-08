import { useEffect, useRef } from 'react';

export default function GoogleAd({ adSlot, adFormat = 'auto', style = {} }) {
    const adRef = useRef(null);

    useEffect(() => {
        try {
            if (adRef.current && adRef.current.offsetWidth > 0) {
                (window.adsbygoogle = window.adsbygoogle || []).push({});
            }
        } catch (e) {
            // adsbygoogle already initialized for this element
        }
    }, []);

    return (
        <div style={{ overflow: 'hidden', ...style }}>
            <ins
                ref={adRef}
                className="adsbygoogle"
                style={{ display: 'block' }}
                data-ad-client="ca-pub-2625181666337030"
                data-ad-slot={adSlot}
                data-ad-format={adFormat}
                data-full-width-responsive="true"
            />
        </div>
    );
}
