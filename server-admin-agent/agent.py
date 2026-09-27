#!/usr/bin/env python3
import json, os, shutil, subprocess, time, urllib.request

WORKER_URL = os.environ["WORKER_URL"].rstrip("/")
TOKEN = os.environ["SERVER_AGENT_TOKEN"]
SERVICES = {"rusticket": os.getenv("RUSTICKET_CONTAINER", "rusticket"), "rustplus": os.getenv("RUSTPLUS_CONTAINER", "rustplus")}

def request(path, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(WORKER_URL + path, data=data, method=method, headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.loads(response.read() or b"{}")

def run(*args, timeout=30):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)

def human(value):
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if value < 1024: return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} PiB"

def cpu_percent():
    def read():
        parts = open("/proc/stat", encoding="utf-8").readline().split()[1:]
        nums = [int(x) for x in parts]; return sum(nums), nums[3] + (nums[4] if len(nums) > 4 else 0)
    total1, idle1 = read(); time.sleep(.2); total2, idle2 = read()
    return round(100 * (1 - (idle2-idle1) / max(1, total2-total1)), 1)

def metrics():
    mem = {}
    for line in open("/proc/meminfo", encoding="utf-8"):
        key, value = line.split(":", 1); mem[key] = int(value.strip().split()[0]) * 1024
    total, available = mem["MemTotal"], mem.get("MemAvailable", mem["MemFree"]); used = total - available
    disk = shutil.disk_usage("/")
    uptime = int(float(open("/proc/uptime", encoding="utf-8").read().split()[0]))
    services = {}
    for key, container in SERVICES.items():
        result = run("docker", "inspect", "--format", "{{.State.Status}}", container)
        status = result.stdout.strip() if result.returncode == 0 else "not found"
        services[key] = {"status": status, "running": status == "running"}
    return {"cpu": cpu_percent(), "memory": {"percent": round(used*100/total,1), "used": human(used), "total": human(total)}, "disk": {"percent": round(disk.used*100/disk.total,1), "used": human(disk.used), "total": human(disk.total)}, "uptime": f"{uptime//86400}д {(uptime%86400)//3600}ч", "services": services}

def execute(command):
    service, action = command.get("service"), command.get("action")
    if service not in SERVICES or action not in ("status", "logs", "restart"): return False, "Команда запрещена"
    container = SERVICES[service]
    if action == "status": result = run("docker", "inspect", "--format", "Статус: {{.State.Status}}\nЗапущен: {{.State.StartedAt}}\nРестарты: {{.RestartCount}}", container)
    elif action == "logs": result = run("docker", "logs", "--tail", "80", container)
    else: result = run("docker", "restart", container, timeout=60)
    output = (result.stdout + result.stderr).strip()
    return result.returncode == 0, output[-3500:]

while True:
    try:
        request("/agent/heartbeat", "POST", metrics())
        item = request("/agent/poll").get("command")
        if item:
            ok, output = execute(item)
            request("/agent/result", "POST", {"id": item["id"], "ok": ok, "output": output})
    except Exception as error:
        print(f"agent error: {type(error).__name__}", flush=True)
    time.sleep(10)

