#pragma once

#include "util.h"

namespace net {

class Socket {
 public:
  bool open();

 private:
  Checksum checksum;
};

}  // namespace net
