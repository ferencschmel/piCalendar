# Turning the Pi into a kiosk display

The dashboard is a plain web page, so any browser in kiosk mode works. On
Raspberry Pi OS with the desktop:

```bash
sudo apt-get install -y chromium-browser unclutter
mkdir -p ~/.config/autostart
```

Create `~/.config/autostart/picalendar.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=piCalendar
# --noerrdialogs and --disable-session-crashed-bubble stop a power cut from
# leaving a "Restore pages?" prompt covering the calendar.
Exec=chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --disable-session-crashed-bubble --incognito \
  --check-for-update-interval=31536000 \
  http://localhost:4000/
X-GNOME-Autostart-enabled=true
```

Hide the mouse pointer and stop the screen blanking:

```bash
# ~/.config/autostart/unclutter.desktop
[Desktop Entry]
Type=Application
Exec=unclutter -idle 3
```

```bash
# Disable blanking (Wayland/labwc on Pi OS Bookworm)
sudo raspi-config nonint do_blanking 1
```

The dashboard already re-polls immediately when the tab becomes visible, so a
screen that sleeps and wakes shows current data without a manual reload.

To reach the admin page from the wall display, tap the top-right corner — the
gear hotspot is deliberately faint so it does not distract.
