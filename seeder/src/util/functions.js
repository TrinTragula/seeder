import { useEffect, useState } from 'react';

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
            // the textarea goes away whether execCommand succeeds, fails or throws
            try {
                document.execCommand('copy') ? res() : rej();
            } catch (error) {
                rej(error);
            } finally {
                textArea.remove();
            }
        });
    }
}

// useDebounce hook (taken from https://usehooks.com/useDebounce/)
export function useDebounce(value, delay) {
    // State and setters for debounced value
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(
        () => {
            // Update debounced value after delay
            const handler = setTimeout(() => {
                setDebouncedValue(value);
            }, delay);
            // Cancel the timeout if value changes (also on delay change or unmount)
            // This is how we prevent debounced value from updating if value is changed ...
            // .. within the delay period. Timeout gets cleared and restarted.
            return () => {
                clearTimeout(handler);
            };
        },
        [value, delay] // Only re-call effect if value or delay changes
    );
    return debouncedValue;
}

export const toHHMMSS = function (milliseconds) {
    const sec_num = parseInt(milliseconds / 1000, 10);
    let hours = Math.floor(sec_num / 3600);
    let minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    let seconds = sec_num - (hours * 3600) - (minutes * 60);

    let response = "";
    if (hours > 0) {
        response += hours + 'h ';
    }
    if (hours > 0 || minutes > 0) {
        response += minutes + 'm ';
    }
    return response + seconds + "s";
}