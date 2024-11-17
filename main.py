import asyncio
import network
import ntptime
import re
import sys
import time
from machine import Pin, WDT

# https://github.com/miguelgrinberg/microdot
from microdot import Microdot, Response
# https://github.com/eddmann/pico-2fa-totp
from totp import totp

import config

__wdt = WDT()
__wdt_monitors = []

network.country(config.WIFI_COUNTRY)
network.hostname(config.HOSTNAME)
__nic = network.WLAN(network.STA_IF)

__min_time = None
__deadline = {}
__pin = Pin(config.PIN, Pin.OUT)
__pin_active = False


async def watchdog_task():
    good_times = {}
    while True:
        now = time.ticks_ms()
        good = True
        for monitor_func, timeout in __wdt_monitors:
            good_time = good_times.get(id(monitor_func), now)
            if not monitor_func():
                good_time = now
            elif time.ticks_diff(now, good_time) >= timeout:
                good = False
            good_times[id(monitor_func)] = good_time
        if good:
            __wdt.feed()
        await asyncio.sleep(1)


async def wifi_task():
    # Reconnect WIFI to renew DHCP lease
    while True:
        __nic.active(True)
        __nic.connect(config.WIFI_SSID, config.WIFI_PASSWORD)
        await asyncio.sleep(60 * 60)
        __nic.disconnect()
        __nic.active(False)
        __nic.deinit()


def get_time():
    global __min_time
    if __min_time is None:
        return None
    __min_time = max(__min_time, time.time())
    return __min_time


async def time_task():
    global __min_time
    while True:
        try:
            ntptime.settime()
        except MemoryError:
            raise
        except Exception as e:
            sys.print_exception(e)
            await asyncio.sleep(60)
        else:
            if __min_time is None:
                __min_time = time.time()
            await asyncio.sleep(60 * 60 * 6)


async def activate_pin_task():
    global __pin_active
    if __pin_active:
        return
    __pin.on()
    __pin_active = True
    try:
        await asyncio.sleep(config.PIN_ACTIVE_SECS)
    finally:
        __pin.off()
        __pin_active = False


def verify_totp(time_, secret, pin):
    for deviation in range(-config.TOTP_ACCEPTED_DEVIATION,
                           config.TOTP_ACCEPTED_DEVIATION + 1):
        if pin == totp(time_ + deviation * config.TOTP_STEP_SECS, secret,
                       config.TOTP_STEP_SECS, config.TOTP_DIGITS)[0]:
            return True
    return False


app = Microdot()


@app.errorhandler(MemoryError)
async def memory_error(request, exception):
    request.app.shutdown()
    return 'Out Of Memory', 500


def q(s):
    '''Quote HTML'''
    return (
        str(s)
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
        .replace("'", '&#39;')
    )


async def html_header_stream():
    yield '<!DOCTYPE html>'
    yield '<html lang="en">'
    yield '<meta charset="utf-8">'
    yield '<title>'
    if config.TITLE:
        yield f'{q(config.TITLE)} - '
    yield 'Door Lock</title>'
    yield '<meta content="width=device-width, initial-scale=1"'
    yield ' name="viewport">'
    yield '<meta name="theme-color" content="#009966">'
    yield '<link href="/icon.png" type="image/png" rel="shortcut icon">'
    yield '<link rel="stylesheet" href="/base.css">'


@app.get('/')
def index(request):
    id_ = request.args.get('id')
    id_ = id_ if isinstance(id_, str) else ''
    password = request.args.get('password')
    password = password if isinstance(password, str) else ''
    if password:
        return auth(id_, password)

    async def stream():
        yield from html_header_stream()
        yield '<section>'
        yield f'<h1>{q(config.TITLE)}</h1>'
        yield '<form autocomplete="off" method="get" action="/">'
        yield '<input name="id" type="text" placeholder="Id"'
        yield f' value="{q(id_)}">'
        yield '<input name="password" type="text" inputmode="numeric"'
        yield f' maxlength="{config.TOTP_DIGITS:d}"'
        yield f' pattern="\\d{{{config.TOTP_DIGITS:d}}}"'
        yield f' value="{q(password)}" placeholder="Password" required>'
        yield '<input class="default" type="submit" value="Open">'
        yield '</form>'
        yield '</section>'
    return Response(body=stream(),
                    headers={'Content-Type': 'text/html; charset=utf-8'})


def auth(id_, password):
    secret = config.SECRETS.get(id_)
    if secret is None:
        return Response.redirect('/status/404/Unknown-Id')
    time_ = get_time()
    if time_ is None:
        return Response.redirect('/status/503/Time-Not-Synchronized')
    if time_ <= __deadline.get(id_, 0):
        return Response.redirect('/status/429/Rate-Limited')
    if (len(password) != config.TOTP_DIGITS or
            not verify_totp(time_, secret, password)):
        __deadline[id_] = time_ + config.LOCKOUT_SECS
        return Response.redirect('/status/403/Wrong-Password')
    asyncio.create_task(activate_pin_task())
    return Response.redirect('/status/200/OK')


@app.get('/icon.png')
def icon_png(request):
    return Response.send_file('icon.png', max_age=3600)


@app.get('/base.css')
def base_css(request):
    return Response.send_file('base.css', max_age=3600)


@app.get('/status/<int:status>/<status_text>')
def status(request, status, status_text):
    status_text = status_text.replace('-', ' ')
    if (status < 200 or (300 <= status and status < 400) or 600 <= status or
            len(status_text) > 100 or
            not re.match(r'^[A-Za-z]+(?: [A-Za-z]+)*$', status_text)):
        return 'Not Found', 404

    async def stream():
        if 200 <= status and status < 300:
            level = 'success'
        elif status == 429 or status == 503:
            level = 'warn'
        else:
            level = 'error'
        yield from html_header_stream()
        yield '<noscript><style>button{display:none;}</style></noscript>'
        yield '<section style="'
        yield f'background:var(--{level}-color);'
        yield f'color:var(--{level}-foreground-color);'
        yield '">'
        yield f'<h1>{q(config.TITLE)}</h1>'
        yield f'<p style="margin:30px;text-align:center;">{q(status_text)}</p>'
        yield '<button title="Back" onclick="history.back()" style="'
        yield 'width:100%;'
        yield f'background:var(--{level}-color-darker);'
        yield f'color:var(--{level}-foreground-color);'
        yield '">'
        yield '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none"'
        yield ' xmlns="http://www.w3.org/2000/svg">'
        yield '<path fill="currentColor" d="M1.02698 11.9929L5.26242 16.2426'
        yield 'L6.67902 14.8308L4.85766 13.0033L22.9731 13.0012'
        yield 'L22.9728 11.0012L4.85309 11.0033L6.6886 9.17398L5.27677 7.75739'
        yield 'L1.02698 11.9929Z"/>'
        yield '</svg>'
        yield '</button>'
        yield '</section>'
    return Response(body=stream(), status_code=status, reason=status_text,
                    headers={'Content-Type': 'text/html; charset=utf-8'})


__wdt_monitors.extend([
    (asyncio.create_task(time_task()).done, 0),
    (asyncio.create_task(watchdog_task()).done, 0),
    (asyncio.create_task(wifi_task()).done, 0),
    (lambda: not __nic.isconnected(), 600_000),
])
app.run(port=80)
