#include "socket.h"

namespace net {

bool Socket::open() {
  return checksum.value == 0;
}

}  // namespace net
