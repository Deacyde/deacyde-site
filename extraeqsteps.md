# EQ Steam Deck — Connection Steps

> Server is fully running on **192.168.1.84**
> Login: **deacyde** / **Password**

---

## Step 1 — Find your EQ RoF2 client directory

Common locations on Steam Deck (run in terminal/Desktop Mode):

```bash
find ~/.steam -name "eqhost.txt" 2>/dev/null
find ~/Games -name "eqhost.txt" 2>/dev/null
find /run/media -name "eqhost.txt" 2>/dev/null
```

---

## Step 2 — Edit eqhost.txt

Once found, open `eqhost.txt` in that directory and replace ALL content with:

```
[LoginServer]
Host=192.168.1.84:5998
```

Save it. That's it — points the client at the local loginserver.

---

## Step 3 — Launch EQ

Start the RoF2 client. At the login screen:
- **Username:** `deacyde`
- **Password:** `Password`

You should see **Deacyde Test Server** in the server list.

---

## Step 4 — Create a character

Pick a server → create character → play.

If you want a GM character for testing, on the server machine run:
```bash
mysql -u root -p'EQrootpass123!' peq -e "UPDATE account SET status=200 WHERE name='deacyde';"
```
Then in-game type: `#zone poknowledge` or `#givemoney 1000000`

---

## Troubleshooting

**"Invalid password" at login screen:**
```bash
# Re-set the password on the Fedora machine (192.168.1.84):
mysql -u root -p'EQrootpass123!' peq -e "UPDATE login_accounts SET account_password=SHA1('Password') WHERE account_name='deacyde';"
```

**Can't see the server in list:**
- Make sure you're on the same WiFi network as 192.168.1.84
- Check server is running: SSH to 192.168.1.84 and run:
  ```bash
  sudo -u eqemu bash -c "cd /home/eqemu/server && ./server_status.sh"
  ```

**Server shows but can't zone in:**
- Firewall ports needed: 5998 UDP, 7000-7100 UDP, 9000 TCP
- Already opened on the Fedora machine — should be fine on LAN

---

## Server Info (for reference)

| Thing | Value |
|-------|-------|
| Server IP | `192.168.1.84` |
| Loginserver port | `5998` |
| Username | `deacyde` |
| Password | `Password` |
| Server name | `Deacyde Test Server` |
