import asyncio
import errno
import network
import ntptime
import sys
import time
from machine import Pin, WDT

# https://github.com/miguelgrinberg/microdot
from microdot import Microdot, send_file
# https://github.com/eddmann/pico-2fa-totp
from totp import totp

WIFI_SSID = ''
WIFI_PASSWORD = ''
HOSTNAME = 'door'
WIFI_COUNTRY = ''
SECRETS = {
    '': '***base32 encoded secret***',
}
LOCKOUT_SECS = 30
TOTP_STEP_SECS = 30
TOTP_DIGITS = 6
TOTP_ACCEPTED_DEVIATION = 5
PIN = 0
PIN_ACTIVE_SECS = 5


__min_time = None
__deadline = {}
__pin = Pin(PIN, Pin.OUT)
__pin_active = False


async def watchdog_task():
    wdt = WDT()
    while True:
        await asyncio.sleep(1)
        wdt.feed()


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
        await asyncio.sleep(PIN_ACTIVE_SECS)
    finally:
        __pin.off()
        __pin_active = False


def extract_id_and_pin(query_string):
    p = query_string.rfind(':')
    if p < 0:
        return '', query_string
    return query_string[:p], query_string[p + 1:]


def verify_totp(time_, secret, pin):
    for deviation in range(-TOTP_ACCEPTED_DEVIATION,
                           TOTP_ACCEPTED_DEVIATION + 1):
        if pin == totp(time_ + deviation*TOTP_STEP_SECS, secret,
                       TOTP_STEP_SECS, TOTP_DIGITS)[0]:
            return True
    return False


app = Microdot()


@app.get('/')
def get(request):
    return send_file('www/index.html', max_age=3600)


@app.get('/<path:path>')
def static(request, path):
    if any(p in ['', '.', '..'] for p in path.split('/')):
        return 'File not found', 404
    try:
        return send_file('www/' + path, max_age=3600)
    except OSError as e:
        if e.errno == errno.ENOENT:
            return 'File not found', 404
        raise


@app.post('/')
def index(request):
    if request.content_type:
        return 'Request-Denied', 415
    id_, pin = extract_id_and_pin(request.query_string)
    secret = SECRETS.get(id_)
    if secret is None:
        return 'Unknown-Id', 404
    time_ = get_time()
    if time_ is None:
        return 'Time-Not-Synchronized', 503
    if time_ <= __deadline.get(id_, 0):
        return 'Rate-Limited', 429
    if len(pin) != TOTP_DIGITS or not verify_totp(time_, secret, pin):
        __deadline[id_] = time_ + LOCKOUT_SECS
        return 'Wrong-Password', 403
    asyncio.create_task(activate_pin_task())
    return 'OK', 200


network.country(WIFI_COUNTRY)
network.hostname(HOSTNAME)
nic = network.WLAN(network.STA_IF)
nic.active(True)
nic.connect(WIFI_SSID, WIFI_PASSWORD)

asyncio.create_task(time_task())
asyncio.create_task(watchdog_task())
app.run(port=80)
