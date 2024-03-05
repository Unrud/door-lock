const loadPage = document.getElementById("load");
const loadPageTitle = loadPage.querySelector('*[data-name="title"]');
const resultPage = document.getElementById("result");
const resultPageTitle = resultPage.querySelector('*[data-name="title"]');
const resultPageMessage = resultPage.querySelector('*[data-name="message"]');
const authPage = document.getElementById("auth");
const authPageTitle = authPage.querySelector('*[data-name="title"]');
const authPageForm = authPage.querySelector("form");
const authPageId = authPageForm.querySelector('input[name="id"]');
const authPagePassword = authPageForm.querySelector('input[name="password"]');

const getUrl = () => location.href.replace(/#.*/, "");

const setPage = (pageElement) => document.documentElement.setAttribute("data-page", pageElement.id);

const showAuth = () => setPage(authPage);

const showLoad = () => setPage(loadPage);

const showResult = (level, message) => {
    resultPageMessage.innerText = message;
    resultPage.classList.toggle("success", level === "success");
    resultPage.classList.toggle("warn", level === "warn");
    resultPage.classList.toggle("error", level === "error");
    setPage(resultPage);

    const state = {page: "result", level: level, message: message};
    if (history.state?.replace_history || history.state?.page === "result") {
        history.replaceState(state, "", getUrl());
    } else {
        history.pushState(state, "", getUrl());
    }
}

authPageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const auth = authPageId.value + (authPageId.value && ":") + authPagePassword.value;
    showLoad();
    let status, message;
    try {
        const response = await fetch(`${URL}?${encodeURI(auth)}`);
        message = await response.text();
        status = response.status;
    } catch (err) {
        console.error(err);
        showResult("error", err.message);
        return;
    }
    if (200 <= status && status < 300) {
        showResult("success", message);
    } else if (status === 429) {
        showResult("warn", message);
    } else {
        showResult("error", message);
    }
});

window.onpopstate = () => {
    if (history.state?.page === "result") {
        showResult(String(history.state.level), String(history.state.message));
        return;
    }
    if (location.hash) {
        let id = "", password = location.hash.substring(1);
        const separatorIndex = password.lastIndexOf(":");
        if (separatorIndex !== -1) {
            id = password.substring(0, separatorIndex);
            password = password.substring(separatorIndex + 1);
        }
        authPageId.value = id;
        authPagePassword.value = password;
        if (authPageForm.checkValidity()) {
            history.replaceState({replace_history: true}, "");
            authPageForm.requestSubmit();
            return;
        }
    }
    history.replaceState(history.state, "", getUrl());
    showAuth();
};

document.title = `${TITLE} - ${document.title}`;
loadPageTitle.innerText = TITLE;
resultPageTitle.innerText = TITLE;
authPageTitle.innerText = TITLE;
window.onpopstate();
