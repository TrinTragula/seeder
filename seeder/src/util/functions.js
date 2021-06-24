
export const debounce = (func, wait = 25) => {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, wait);
    };
}

export const copyToClipboard = (textToCopy) => {
    // navigator clipboard api needs a secure context (https)
    if (navigator.clipboard && window.isSecureContext) {
        // navigator clipboard api method'
        return navigator.clipboard.writeText(textToCopy);
    } else {
        // text area method
        let textArea = document.createElement("textarea");
        textArea.value = textToCopy;
        // make the textarea out of viewport
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        return new Promise((res, rej) => {
            // here the magic happens
            document.execCommand('copy') ? res() : rej();
            textArea.remove();
        });
    }
}

export const setUrl = (seed, mcVersion, setButtonText) => {
    if (window.history.pushState) {
        let newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        newUrl += `?seed=${seed}&version=${mcVersion}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
        setButtonText('COPY');
    }
}