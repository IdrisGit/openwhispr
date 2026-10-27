#define _GNU_SOURCE
#include <atspi/atspi.h>
#include <stdio.h>

/* A synthetic accessibility graph keeps this test off the real desktop and bus. */
static GObject *desktop;
static GObject *application;
static GObject *window;
static int criticals;

static int fixture_atspi_init(void) { return 0; }
static void fixture_atspi_set_timeout(gint timeout, gint startup_timeout) {}
static AtspiAccessible *fixture_atspi_get_desktop(gint index) {
  return (AtspiAccessible *)desktop;
}
static gint fixture_child_count(AtspiAccessible *object, GError **error) {
  return 1;
}
static AtspiAccessible *fixture_child(AtspiAccessible *object, gint index, GError **error) {
  return (AtspiAccessible *)g_object_ref((GObject *)object == desktop ? application : window);
}
static AtspiStateSet *fixture_state_set(AtspiAccessible *object) {
  return NULL;
}

#define HAVE_ATSPI
#define main fast_paste_main
#define atspi_init fixture_atspi_init
#define atspi_set_timeout fixture_atspi_set_timeout
#define atspi_get_desktop fixture_atspi_get_desktop
#define atspi_accessible_get_child_count fixture_child_count
#define atspi_accessible_get_child_at_index fixture_child
#define atspi_accessible_get_state_set fixture_state_set
#include "../../resources/linux-fast-paste.c"
#undef main

static void record_critical(const gchar *domain, GLogLevelFlags level,
                            const gchar *message, gpointer data) {
  criticals++;
}

int main(void) {
  desktop = g_object_new(G_TYPE_OBJECT, NULL);
  application = g_object_new(G_TYPE_OBJECT, NULL);
  window = g_object_new(G_TYPE_OBJECT, NULL);
  g_log_set_always_fatal(G_LOG_LEVEL_ERROR);
  guint handler = g_log_set_handler("GLib-GObject", G_LOG_LEVEL_CRITICAL,
                                    record_critical, NULL);

  int result = detect_terminal_atspi();
  g_log_remove_handler("GLib-GObject", handler);
  g_object_unref(window);
  g_object_unref(application);
  g_object_unref(desktop);
  if (result != -1 || criticals != 0) {
    fprintf(stderr, "expected unknown without GLib criticals; got result=%d criticals=%d\n",
            result, criticals);
    return 1;
  }
  puts("AT-SPI missing state handled without GLib criticals");
  return 0;
}
