import type { ReactNode } from "react";
import Content from "@theme-original/DocItem/Content";
import type ContentType from "@theme/DocItem/Content";
import type { WrapperProps } from "@docusaurus/types";
import LlmNotice from "@site/src/components/LlmNotice";

type Props = WrapperProps<typeof ContentType>;

// Wrapper swizzle: puts the LLM-generated notice at the top of every doc page.
export default function ContentWrapper(props: Props): ReactNode {
  return (
    <>
      <LlmNotice />
      <Content {...props} />
    </>
  );
}
