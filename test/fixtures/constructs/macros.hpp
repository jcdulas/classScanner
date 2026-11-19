// Export macros are detected automatically; class-body macros must be configured.
class MYLIB_API Exported : public Base {
public:
  int value;
};

struct GUI_EXPORT Widget final : Exported {
  Q_OBJECT
public:
  Widget();
};

class Renderer
{
  DECLARE_DYNAMIC(Renderer)
  int frames;
};
