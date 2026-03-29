# EQ Server Migration to Beelink SER5 MAX

This guide covers migrating the EQEmu server from the Fedora laptop to the Beelink SER5 MAX.

---

## What to Copy from the Old Machine

```bash
# Copy entire server install
rsync -avz /home/eqemu/server/ beelink:/home/eqemu/server/

# Copy compiled Perl 5.32.1 (saves ~10 min rebuild)
rsync -avz /opt/eqemu-perl/ beelink:/opt/eqemu-perl/
```

---

## Fresh Setup Steps on Beelink

### 1. Install Fedora Dependencies

```bash
sudo dnf install -y mysql-server perl perl-core gcc gcc-c++ cmake make \
  zlib-devel libuuid-devel libcrypt-devel git curl
```

### 2. Create eqemu User

```bash
sudo useradd -m -s /bin/bash eqemu
sudo passwd eqemu
```

### 3. Set Up MySQL

```bash
sudo systemctl enable --now mysqld
sudo mysql_secure_installation

# Create DB and user
sudo mysql -u root -p << EOF
CREATE DATABASE peq;
CREATE USER 'eqemu'@'localhost' IDENTIFIED BY 'eqemupass';
GRANT ALL PRIVILEGES ON peq.* TO 'eqemu'@'localhost';
FLUSH PRIVILEGES;
EOF

# Import the database from old machine
mysqldump -u eqemu -peqemupass peq | ssh beelink "mysql -u eqemu -peqemupass peq"
```

### 4. Fix MySQL Socket Path (Fedora-specific)

Fedora puts the MySQL socket at `/var/lib/mysql/mysql.sock` but EQEmu expects `/run/mysqld/mysqld.sock`. Make it persistent:

```bash
sudo mkdir -p /run/mysqld
sudo bash -c 'echo "L /run/mysqld/mysqld.sock - - - - /var/lib/mysql/mysql.sock" > /etc/tmpfiles.d/mysqld-compat.conf'
sudo systemd-tmpfiles --create /etc/tmpfiles.d/mysqld-compat.conf
```

### 5. Install Perl 5.32.1 to /opt/eqemu-perl

The EQEmu zone binary has RUNPATH `/opt/eqemu-perl/lib/5.32.1/x86_64-linux-thread-multi/CORE`.  
If you copied `/opt/eqemu-perl` from the old machine, skip this. If building fresh:

```bash
cd /tmp
curl -L https://www.cpan.org/src/5.0/perl-5.32.1.tar.gz -o perl-5.32.1.tar.gz
tar xzf perl-5.32.1.tar.gz
cd perl-5.32.1

# Configure
./Configure -des -Dprefix=/opt/eqemu-perl -Dusethreads -Duse64bitall -Duseshrplib -Doptimize='-O2'

# SDBM_File and Math-BigInt-FastCalc fail on GCC 14+ — remove them before building
mv ext/SDBM_File ext/SDBM_File.disabled
mv cpan/Math-BigInt-FastCalc cpan/Math-BigInt-FastCalc.disabled

# Build and install (takes ~10 min)
CORES=4
make -j$CORES
sudo make install -k
```

Verify:
```bash
ls /opt/eqemu-perl/lib/5.32.1/x86_64-linux-thread-multi/CORE/libperl.so
# Should exist and not be empty
```

### 6. Create Required Directories and Symlinks

```bash
# EQEmu checks for this directory at startup
sudo mkdir -p /opt/eqemu-perl  # already exists if you did step 5

# Zone binary looks for lua_modules and plugins at server root, not quests/
ln -sf /home/eqemu/server/quests/lua_modules /home/eqemu/server/lua_modules
ln -sf /home/eqemu/server/quests/plugins /home/eqemu/server/plugins
```

### 7. Configure login.json

File: `/home/eqemu/server/login.json`

Make sure `security.mode` is `14` (SCrypt — matches how accounts are created):

```json
"security": {
    "mode": 14
}
```

### 8. Fix server_launcher.pl (Duplicate Check Bug)

The launcher uses `ps aux` to check if it's already running, but the sudo parent process also matches, causing it to exit immediately. Replace with a PID file check:

In `/home/eqemu/server/server_launcher.pl`, find:

```perl
if ($kill_server == 0 && $print_status_once == 0) {
    $l_processes  = `ps aux`;
    ...
    if ($lc_count > 1) {
        print "Launcher already running... Exiting...\n";
        exit;
    }
}
```

Replace with:

```perl
if ($kill_server == 0 && $print_status_once == 0) {
    my $pid_file = '/tmp/eqemu_launcher.pid';
    if (-e $pid_file) {
        open(my $fh, '<', $pid_file); my $old_pid = <$fh>; close($fh);
        chomp $old_pid;
        if ($old_pid && -d "/proc/$old_pid") {
            print "Launcher already running (PID $old_pid)... Exiting...\n";
            exit;
        }
    }
    open(my $fh, '>', $pid_file); print $fh $$; close($fh);
}
```

### 9. Start the Server

```bash
sudo -u eqemu bash -c 'cd /home/eqemu/server && bash server_start.sh'
```

`server_start.sh` runs shared_memory, loginserver, and server_launcher.pl with 30 zones.

---

## Steam Deck Client Setup

In your EQ install on the Steam Deck, edit `eqhost.txt`:

```
[LoginServer]
Host=192.168.1.XXX:5999    # Use the Beelink's IP, port 5999 for RoF2 client
```

> **Important:** Port **5999** is for RoF2/SoD+ clients. Port 5998 is Titanium only. Using the wrong port causes login to hang.

---

## Login Account

The login account was created with the EQEmu loginserver CLI and uses SCrypt hashing:

- **Username:** deacyde  
- **Password:** Password  

If you need to recreate it:
```bash
cd /home/eqemu/server
./loginserver login-user:create --username deacyde --password Password
```

---

## Known Issues / Notes

| Issue | Fix |
|-------|-----|
| Zone crashes with Perl SIGSEGV | Perl 5.32.1 must be at `/opt/eqemu-perl` — system Perl 5.42 is ABI-incompatible |
| Zones show server as DOWN | All 30 zones must connect before status shows UP (takes ~15s after start) |
| Tutorial zone (tutorialb) crashes | Skip tutorial at character creation — uncheck the Tutorial box |
| MySQL socket not found | Add tmpfiles.d entry (step 4 above) |
| Login hangs | Check `eqhost.txt` uses port 5999, not 5998 |
| Character stuck in crashed zone | `UPDATE character_data SET zone_id=202, x=0, y=0, z=4, heading=0 WHERE id=X;` (202 = Plane of Knowledge) |

---

## Server IP Change Checklist

When moving to Beelink, the IP will change. Update:

1. `eqhost.txt` on Steam Deck — new IP
2. `/home/eqemu/server/eqemu_config.json` — check `server.world.localaddress` and `server.world.address`
3. Firewall rules if any are set
