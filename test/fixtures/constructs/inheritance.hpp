// Single, multiple and virtual inheritance, with each access level.
class Base {};
class Mixin {};
class Other {};

class Derived : public Base, protected virtual Mixin, Other {};

struct PublicByDefault : Base {};

template <typename T>
class Wrapper : public Base, public Container<T> {};
