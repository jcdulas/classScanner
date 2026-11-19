// Template classes, specializations and member templates.
template <typename T, int N = 3>
class Buffer {
public:
  T items[N];
  template <typename U>
  void copyFrom(const Buffer<U, N>& other);
};

template <>
class Buffer<bool, 8> {
public:
  unsigned char bits;
};

template <typename T>
class Buffer<T*, 1> {};

template <typename Key, typename Value>
struct Pair;
