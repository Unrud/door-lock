const keysPage = document.getElementById("keys");
const keysPageNew = keysPage.querySelector('button[data-name="new"]');
const keysPageTemplate = keysPage.querySelector("template");
const editKeyPage = document.getElementById("edit-key");
const editKeyPageShare = editKeyPage.querySelector('button[data-name="share"]');
const editKeyPageCopy = editKeyPage.querySelector('button[data-name="copy"]');
const editKeyPageForm = editKeyPage.querySelector("form");
const editKeyPageCreate = editKeyPageForm.querySelector('input[data-name="create"]');
const editKeyPageUpdate = editKeyPageForm.querySelector('input[data-name="update"]');
const editKeyPageDelete = editKeyPageForm.querySelector('button[data-name="delete"]');

const getKeys = () => {
    let keys;
    try {
        keys = JSON.parse(localStorage.getItem("keys") ?? "[]");
    } catch(err) {
        console.error(`Invalid keys: ${err}`);
        return [];
    }
    if (!keys instanceof Array) {
        console.error(`Invalid keys: not an Array`);
        return [];
    }
    return keys.filter((key) => {
        let pass = (typeof(key.uuid) === "string" && key.uuid &&
                    typeof(key.name) === "string" && key.name &&
                    typeof(key.url) === "string" && key.url &&
                    typeof(key.id) === "string" &&
                    typeof(key.secret) === "string" && key.secret);
        if (pass) {
            try {
                decodeBase32(key.secret);
            } catch {
                pass = false;
            }
        }
        if (!pass) {
            console.error(`Invalid key: ${JSON.stringify(key)}`);
        }
        return pass;
    });
};
const setKeys = (keys) => localStorage.setItem("keys", JSON.stringify(keys));

const decodeBase32 = (s) => {
    const byteValues = [];
    let byteValue = 0, bitCount = 8;
    for (const symbol of s.replace(/\s|[\s=]+$/g, "")) {
        const symbolValue = (parseInt(symbol, 36) + 24) % 34;
        if (isNaN(symbolValue) || symbol === "0" || symbol === "1" || symbol === "8" || symbol === "9") {
            throw new Error(`Invalid Base32 data: ${JSON.stringify(s)}`);
        }
        bitCount -= 5;
        if (bitCount <= 0) {
            byteValue += symbolValue >> (-bitCount);
            byteValues.push(byteValue);
            byteValue = 0;
            bitCount += 8;
        }
        byteValue += (symbolValue << bitCount) & 0xFF;
    }
    return new Uint8Array(byteValues);
};

const generateHotp = async (secret, counter, digits = 6) => {
    const secretBytes = decodeBase32(secret);
    const secretKey = await window.crypto.subtle.importKey(
        "raw", secretBytes, { name: 'HMAC', hash: { name: 'SHA-1' } }, false, ["sign"]);
    const counterBytes = new Uint8Array(8);
    for (let i = counterBytes.length - 1; i >= 0; i -= 1) {
        counterBytes[i] = counter & 0xFF;
        counter >>>= 8;
    }
    const hs = new Uint8Array(await window.crypto.subtle.sign("HMAC", secretKey, counterBytes));
    const hsHoffset = hs[19] & 0xF;
    const p = (((hs[hsHoffset] & 0x7F) << 24) |
               (hs[hsHoffset + 1] << 16) |
               (hs[hsHoffset + 2] << 8) |
               hs[hsHoffset + 3]);
    const password = `${"0".repeat(digits)}${p}`.slice(-digits);
    return password;
};

const generateTotp = async (secret, digits = 6, period = 30) => {
    const counter = Math.floor(Date.now() / 1000 / period);
    return await generateHotp(secret, counter, digits);
}

const getUrl = () => location.href.replace(/#.*/, "");

const keyToUri = (key) => `${getUrl()}#${encodeURI(JSON.stringify(key))}`;

const setPage = (pageElement) => document.documentElement.setAttribute("data-page", pageElement.id);

const showKeys = () => {
    keysPage.querySelectorAll(":scope > .buttons").forEach((element) => element.remove());
    for (const key of getKeys().toSorted((a, b) => a.name.localeCompare(b.name))) {
        const entry = keysPageTemplate.content.firstElementChild.cloneNode(true);
        const keyButton = entry.querySelector('*[data-name="key"]');
        const editButton = entry.querySelector('*[data-name="edit"]');
        keyButton.innerText = key.name;
        keyButton.addEventListener("click", async () => {
            const password = await generateTotp(key.secret);
            location.href = `${key.url}#${key.id}${key.id && ":"}${password}`;
        });
        editButton.addEventListener("click", () => showEditKey(key));
        keysPageTemplate.parentNode.insertBefore(entry, keysPageTemplate);
    }
    setPage(keysPage);
}

const getEditKey = () => Object.fromEntries(new FormData(editKeyPageForm));

const showEditKey = (keyTemplate) => {
    for (const name in getEditKey()) {
        editKeyPageForm.elements[name].value = String(keyTemplate?.[name] ?? "");
    }
    editKeyPageForm.elements["uuid"].value ||= window.crypto.randomUUID();

    editKeyPageShare.style.display = navigator.share ? "" : "none";
    editKeyPageCopy.style.display = !navigator.share && navigator.clipboard ? "" : "none";
    const key = getEditKey();
    const keyExists = !!getKeys().find((oKey) => oKey.uuid === key.uuid);
    editKeyPageCreate.style.display = keyExists ? "none" : "";
    editKeyPageUpdate.style.display = keyExists ? "" : "none";
    editKeyPageDelete.style.display = keyExists ? "" : "none";
    setPage(editKeyPage);

    const state = {...getEditKey(), page: "edit-key"};
    if (history.state?.page === "edit-key") {
        history.replaceState(state, "", getUrl());
    } else {
        history.pushState(state, "", getUrl());
    }
};

for (const name in getEditKey()) {
    editKeyPageForm.elements[name].addEventListener("change", () => updateEditKey());
}

editKeyPageCopy.addEventListener("click", () => navigator.clipboard.writeText(keyToUri(getEditKey())));

editKeyPageShare.addEventListener("click", () => {
    const key = getEditKey();
    navigator.share({title: key.name, url: keyToUri(key)});
});

editKeyPageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const key = getEditKey();
    setKeys([...getKeys().filter((oKey) => oKey.uuid !== key.uuid), key]);
    history.back();
});

editKeyPageDelete.addEventListener("click", () => {
    const key = getEditKey();
    setKeys(getKeys().filter((oKey) => oKey.uuid !== key.uuid));
    history.back();
});

keysPageNew.addEventListener("click", () => showEditKey());

window.onpopstate = () => {
    editKeyPageForm.reset();
    if (history.state?.page === "edit-key") {
        showEditKey(history.state);
    } else if (location.hash) {
        let rawKey = null;
        try {
            rawKey = JSON.parse(decodeURI(location.hash.substring(1)));
        } catch (err) {
            console.error(`Invalid key template: ${err}`);
        }
        history.replaceState(history.state, "", getUrl());
        showEditKey(rawKey);
    } else {
        showKeys();
    }
};

window.onpopstate();
