#!/usr/bin/env lua

package.path = "./lib/?.lua;./lib/?/init.lua;" .. package.path

local otp = require("otp")
local sha1 = require("sha1")

local secrets = {
    [""] = "***base32 encoded secret***",
}
local db_path = "/tmp/door"
local gpio_path = "/sys/class/gpio/gpio7/value"
local timeout = 30
local active_time = 5

local function check_type(value, expected_type)
    local actual_type = type(value)
    if actual_type ~= expected_type then
        error("unexpected type: " .. actual_type)
    end
end

local function decode_query(query)
    check_type(query, "string")
    local function hex_to_char(v)
        return string.char(tonumber(v, 16))
    end
    return ({query:gsub("%%(%x%x)", hex_to_char)})[1]
end

local function split_id_password(s)
    check_type(s, "string")
    local _, pos = s:find(".*:")
    if pos == nil then
        return "", s
    end
    return s:sub(1, pos-1), s:sub(pos+1)
end

local function quote_shell(s)
    check_type(s, "string")
    if s:find("%z") then error("embedded null byte") end
    return "'" .. s:gsub("'", "'\\%0'") .. "'"
end

local function quote_shell_path(s)
    check_type(s, "string")
    if s == "" then
        s = "."
    end
    if s:sub(1, 1) ~= "/" and s:sub(1, 1) ~= "." then
        s = "./" .. s
    end
    return quote_shell(s)
end

local function join_path(...)
    local path = ""
    for _, part in ipairs(arg) do
        check_type(part, "string")
        if path ~= "" and path:sub(-1) ~= "/" and part:sub(1, 1) ~= "/" then
            path = path .. "/"
        end
        path = path .. part
        if path == "" then
            path = "."
        end
    end
    return path
end

local function check_execute(command)
    if os.execute(command) ~= 0 then error() end
end

local function http_response(status, message, body)
    io.write(string.format(
        "Status: %d %s\n" ..
        "Content-Type: text/plain; charset=utf-8\n" ..
        "Cache-Control: no-store\n" ..
        "\n%s", status, message, body))
end

local for_time = os.time()
local query = decode_query(os.getenv("QUERY_STRING") or "")

local id, password = split_id_password(query)
local secret = secrets[id]
if secret == nil then
    return http_response(404, "Not Found", "Unknown-Id")
end

local db_key = join_path(db_path, sha1.sha1(id) .. ".limit")
if os.execute(string.format(
        "test \"0$(date --reference %s +%%s 2> /dev/null)\" -gt %d",
        quote_shell_path(db_key), for_time - timeout)) == 0 then
    return http_response(429, "Too Many Requests", "Rate-Limited")
end

if not otp.new_totp_from_key(secret):verify(password, nil, for_time) then
    check_execute("mkdir -p " .. quote_shell_path(db_path))
    check_execute("touch " .. quote_shell_path(db_key))
    return http_response(403, "Forbidden", "Wrong-Password")
end

check_execute("echo 1 > " .. quote_shell_path(gpio_path))
check_execute(string.format("(sleep %d && (echo 0 > %s)) &",
                            active_time, quote_shell_path(gpio_path)))
http_response(200, "OK", "OK")
