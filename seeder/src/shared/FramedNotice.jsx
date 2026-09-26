/*
 * What a page shows instead of the app when another site embeds it in a frame
 * (mountPage, framed.js). The link opens the same page, seed and version included,
 * as the whole tab: inside the frame, location.href is already on our origin. The
 * transient from= marker (a legacy link redirected in the frame) is dropped.
 */
function realPageUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('from');
    return url.href;
}

export default function FramedNotice() {
    return (
        <main className="framed-notice">
            <img src="/logo.png" alt="" width="48" height="48" className="framed-notice__logo" />
            <h1>Open Seeder on its own site</h1>
            <p>This page is showing Seeder inside another website. Seeder is free at mcseeder.com and works best there.</p>
            <a className="btn btn--primary framed-notice__link" href={realPageUrl()} target="_top" rel="noopener">
                Open mcseeder.com
            </a>
        </main>
    );
}
