#include "util.h"

namespace app {

double clampSeconds(double seconds) {
  return seconds < 0 ? 0 : seconds;
}

}  // namespace app
